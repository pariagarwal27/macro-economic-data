"""Record first-release sector changes from the locally archived BLS CES vintages."""
import csv
import io
import sqlite3
import zipfile
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / 'data/databases/nfp_new.sqlite3'
ARCHIVE = ROOT / 'data/ces/raw/cesvinall.zip'
SERIES = {'mining_logging':'100000','construction':'200000','manufacturing':'300000',
          'trade_transport_utilities':'400000','information':'500000','financial':'550000',
          'professional_business':'600000','education_health':'650000','leisure_hospitality':'700000',
          'other_services':'800000','government':'900000'}

def main():
    with sqlite3.connect(DB) as db, zipfile.ZipFile(ARCHIVE) as archive:
        calendar = dict(db.execute('select target_month, release_date from nfp_release_calendar'))
        db.execute('create table if not exists ces_industry_first_release (reference_month text not null, sector text not null, release_date text not null, change_thousands real not null, source_url text not null, primary key(reference_month, sector))')
        for sector, code in SERIES.items():
            member = f'tri_{code}_SA.csv'
            rows = csv.reader(io.TextIOWrapper(archive.open(member), encoding='utf-8-sig'))
            header = next(rows)
            labels = {pd.to_datetime(s, format='%b_%y').strftime('%Y-%m'): i for i, s in enumerate(header[2:], 2)}
            for row in rows:
                month = f'{int(row[0]):04d}-{int(row[1]):02d}'
                previous = str(pd.Period(month, freq='M') - 1)
                if month not in calendar or month not in labels or previous not in labels:
                    continue
                try:
                    value = float(row[labels[month]]) - float(row[labels[previous]])
                except (ValueError, IndexError):
                    continue
                db.execute('insert or ignore into ces_industry_first_release values (?,?,?,?,?)', (month, sector, calendar[month], value, f'https://www.bls.gov/web/empsit/cesvinall.zip#{member}'))
        print(db.execute('select count(*), min(reference_month), max(reference_month), count(distinct reference_month) from ces_industry_first_release').fetchone())

if __name__ == '__main__':
    main()
