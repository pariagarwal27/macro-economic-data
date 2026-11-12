"""Archive Census first-release monthly business-application values."""
import concurrent.futures
import datetime as dt
import hashlib
import re
import sqlite3
from pathlib import Path
from urllib.parse import urljoin

import pymupdf
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
ARCHIVE = ROOT / 'data/forecast_sources/census_bfs'
INDEX = 'https://www.census.gov/econ/bfs/data/historic.html'
DB = ROOT / 'data/databases/nfp_new.sqlite3'

def collect(url):
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    match = re.search(r'bfs_(\d{4})m(\d{2})\.pdf', url, re.I)
    if not match:
        return None
    month = f'{match.group(1)}-{match.group(2)}'
    data = response.content
    doc = pymupdf.open(stream=data, filetype='pdf')
    text = '\n'.join(page.get_text() for page in doc)
    date = re.search(r'FOR RELEASE AT\s+\d+:\d+\s*(?:AM|PM)\s+E[SD]T,\s*([A-Z]+\s+\d{1,2},\s*\d{4})', text, re.I)
    value = re.search(r'With Planned Wages\s+([\d,]+)', text, re.I)
    if not date or not value:
        print('UNPARSED', month, url, flush=True)
        return None
    release = dt.datetime.strptime(date.group(1).title(), '%B %d, %Y').date().isoformat()
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    path = ARCHIVE / (month + '.pdf')
    if path.exists() and hashlib.sha256(path.read_bytes()).digest() != hashlib.sha256(data).digest():
        raise ValueError(f'Existing archived source differs: {path}')
    if not path.exists(): path.write_bytes(data)
    return month, release, int(value.group(1).replace(',', '')), url, hashlib.sha256(data).hexdigest(), str(path)

def main():
    response = requests.get(INDEX, timeout=60)
    response.raise_for_status()
    soup = BeautifulSoup(response.content, 'html.parser')
    urls = sorted({urljoin(INDEX, a['href']) for a in soup.select('a[href]') if re.search(r'bfs_\d{4}m\d{2}\.pdf', a['href'], re.I)})
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        rows = [r for r in pool.map(collect, urls) if r]
    with sqlite3.connect(DB) as db:
        db.execute('create table if not exists bfs_wba_first_release (reference_month text primary key, release_date text not null, value integer not null, source_url text not null, sha256 text not null, source_path text not null)')
        db.executemany('insert or ignore into bfs_wba_first_release values (?,?,?,?,?,?)', rows)
        print('archive links',len(urls),'parsed',len(rows),'stored',db.execute('select count(*),min(reference_month),max(reference_month) from bfs_wba_first_release').fetchone())

if __name__ == '__main__': main()
