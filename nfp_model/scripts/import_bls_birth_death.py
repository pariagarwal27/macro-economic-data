"""Import sourced BLS preliminary birth-death totals without overwriting vintages."""
import json
import sqlite3
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
DB=ROOT/'data/databases/nfp_new.sqlite3'
INPUT=ROOT/'data/forecast_sources/bls_birth_death_preliminary.json'

def main():
    data=json.loads(INPUT.read_text())
    with sqlite3.connect(DB) as db:
        calendar=dict(db.execute('select target_month,release_date from nfp_release_calendar'))
        calendar.update(data.get('additional_release_dates',{}))
        db.execute('create table if not exists bls_birth_death_preliminary (reference_month text primary key, release_date text, value_thousands real not null, source_url text not null, source_vintage text not null)')
        for year, values in data['values'].items():
            for n,value in enumerate(values,1):
                month=f'{year}-{n:02d}'
                source=data['source_current'] if year=='2026' else data['source_history']
                db.execute('insert or ignore into bls_birth_death_preliminary values (?,?,?,?,?)', (month,calendar.get(month),value,source,'current table; benchmark vintage not independently archived' if year=='2026' else 'BLS preliminary annual table'))
                if calendar.get(month):
                    db.execute('update bls_birth_death_preliminary set release_date=? where reference_month=? and release_date is null',(calendar[month],month))
        print(db.execute('select count(*),min(reference_month),max(reference_month),sum(release_date is null) from bls_birth_death_preliminary').fetchone())

if __name__=='__main__': main()
