import type { Repository } from 'typeorm';
import type { CollectionDataDto } from '../collections/dto/collection-data.dto';
import type { DailyData } from '../sites/daily-data.entity';

const DAY_MS = 24 * 60 * 60 * 1000;
const LOOKBACK_DAYS = 7;

export interface HistoricalDailyRow {
  siteId: number | string;
  date: Date | string;
  satelliteTemperature: number | null;
  degreeHeatingDays: number | null;
  dailyAlertLevel: number | null;
  weeklyAlertLevel: number | null;
}

export interface HistoricalCollectionData extends CollectionDataDto {
  /** Date of the actual observation, which can precede the selected day. */
  observedOn?: string;
}

/**
 * Date-only inputs have UTC semantics, regardless of the API server timezone.
 * Return an exclusive upper bound so records on the selected day are included.
 */
export function historicalUtcRange(day: string): {
  startInclusive: Date;
  endExclusive: Date;
} {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(day)) {
    throw new RangeError('asOf must be a YYYY-MM-DD UTC date');
  }

  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== day) {
    throw new RangeError('asOf must be a valid YYYY-MM-DD UTC date');
  }

  const endExclusive = new Date(parsed.getTime() + DAY_MS);
  return {
    startInclusive: new Date(endExclusive.getTime() - LOOKBACK_DAYS * DAY_MS),
    endExclusive,
  };
}

/** Convert daily-data units into the collectionData schema without inventing values. */
export function mapHistoricalDailyRow(
  row: HistoricalDailyRow,
): HistoricalCollectionData {
  const mapped: HistoricalCollectionData = {
    observedOn: new Date(row.date).toISOString().slice(0, 10),
  };

  if (row.satelliteTemperature != null) {
    mapped.satelliteTemperature = row.satelliteTemperature;
  }
  // daily_data is expressed in degree heating DAYS; collectionData uses weeks.
  if (row.degreeHeatingDays != null) {
    mapped.dhw = row.degreeHeatingDays / 7;
  }
  if (row.dailyAlertLevel != null) {
    mapped.tempAlert = row.dailyAlertLevel;
  }
  if (row.weeklyAlertLevel != null) {
    mapped.tempWeeklyAlert = row.weeklyAlertLevel;
  }

  return mapped;
}

/**
 * Return one most-recent observation per site inside a bounded historical window.
 * Never fall back to live/latest data for a date without observations.
 */
export async function getHistoricalCollectionData(
  siteIds: number[],
  dailyDataRepository: Repository<DailyData>,
  asOf: string,
): Promise<Record<number, HistoricalCollectionData>> {
  const { startInclusive, endExclusive } = historicalUtcRange(asOf);
  if (!siteIds.length) return {};

  const rows = await dailyDataRepository
    .createQueryBuilder('daily_data')
    .select('DISTINCT ON (daily_data.site_id) daily_data.site_id', 'siteId')
    .addSelect('daily_data.date', 'date')
    .addSelect('daily_data.satellite_temperature', 'satelliteTemperature')
    .addSelect('daily_data.degree_heating_days', 'degreeHeatingDays')
    .addSelect('daily_data.daily_alert_level', 'dailyAlertLevel')
    .addSelect('daily_data.weekly_alert_level', 'weeklyAlertLevel')
    .where('daily_data.site_id IN (:...siteIds)', { siteIds })
    .andWhere('daily_data.date >= :startInclusive', { startInclusive })
    .andWhere('daily_data.date < :endExclusive', { endExclusive })
    .orderBy('daily_data.site_id', 'ASC')
    .addOrderBy('daily_data.date', 'DESC')
    .getRawMany<HistoricalDailyRow>();

  return rows.reduce<Record<number, HistoricalCollectionData>>(
    (result, row) => {
      result[Number(row.siteId)] = mapHistoricalDailyRow(row);
      return result;
    },
    {},
  );
}
