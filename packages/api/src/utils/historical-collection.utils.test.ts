import type { Repository } from 'typeorm';
import type { DailyData } from '../sites/daily-data.entity';
import {
  getHistoricalCollectionData,
  historicalUtcRange,
  mapHistoricalDailyRow,
} from './historical-collection.utils';

describe('historicalUtcRange', () => {
  it('selects the full requested UTC day and the previous six days', () => {
    const range = historicalUtcRange('2024-03-01');
    expect(range.startInclusive.toISOString()).toBe('2024-02-24T00:00:00.000Z');
    expect(range.endExclusive.toISOString()).toBe('2024-03-02T00:00:00.000Z');
  });

  it.each(['2024-02-30', '2023-02-29', '2024-2-01', '2024-01-01T00:00:00Z', 'nonsense'])(
    'rejects invalid asOf %s',
    (value) => expect(() => historicalUtcRange(value)).toThrow(RangeError),
  );

  it('handles a valid leap day', () => {
    expect(historicalUtcRange('2024-02-29').endExclusive.toISOString()).toBe(
      '2024-03-01T00:00:00.000Z',
    );
  });
});

describe('mapHistoricalDailyRow', () => {
  it('converts degree heating days to weeks, retaining zero and observation date', () => {
    expect(
      mapHistoricalDailyRow({
        siteId: '7',
        date: '2024-02-28T00:00:00Z',
        satelliteTemperature: 0,
        degreeHeatingDays: 14,
        dailyAlertLevel: 0,
        weeklyAlertLevel: null,
      }),
    ).toEqual({
      observedOn: '2024-02-28',
      satelliteTemperature: 0,
      dhw: 2,
      tempAlert: 0,
    });
  });

  it('does not turn missing metrics into fabricated zeros', () => {
    expect(
      mapHistoricalDailyRow({
        siteId: 1,
        date: new Date('2024-01-01T00:00:00.000Z'),
        satelliteTemperature: null,
        degreeHeatingDays: null,
        dailyAlertLevel: null,
        weeklyAlertLevel: null,
      }),
    ).toEqual({ observedOn: '2024-01-01' });
  });
});

describe('getHistoricalCollectionData', () => {
  it('does not query the database if the list of sites is empty', async () => {
    const createQueryBuilder = jest.fn();
    const repo = { createQueryBuilder } as unknown as Repository<DailyData>;
    await expect(getHistoricalCollectionData([], repo, '2024-04-03')).resolves.toEqual({});
    expect(createQueryBuilder).not.toHaveBeenCalled();
  });

  it('queries with an exclusive upper bound and indexes rows by site ID', async () => {
    const query = {
      select: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getRawMany: jest.fn().mockResolvedValue([
        {
          siteId: '17',
          date: '2024-04-02T00:00:00Z',
          satelliteTemperature: 28,
          degreeHeatingDays: 7,
          dailyAlertLevel: 2,
          weeklyAlertLevel: 3,
        },
      ]),
    };
    const repo = {
      createQueryBuilder: jest.fn().mockReturnValue(query),
    } as unknown as Repository<DailyData>;

    const result = await getHistoricalCollectionData([17], repo, '2024-04-03');
    expect(result[17]).toEqual({
      observedOn: '2024-04-02',
      satelliteTemperature: 28,
      dhw: 1,
      tempAlert: 2,
      tempWeeklyAlert: 3,
    });
    expect(query.where).toHaveBeenCalledWith('daily_data.site_id IN (:...siteIds)', {
      siteIds: [17],
    });
    expect(query.andWhere).toHaveBeenCalledWith(
      'daily_data.date < :endExclusive',
      { endExclusive: new Date('2024-04-04T00:00:00.000Z') },
    );
  });
});
