"""Collect original ADP press releases without replacing first-release values."""
import concurrent.futures
import datetime as dt
import re
import sqlite3
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
DB = ROOT / 'data/databases/nfp_new.sqlite3'
HEADERS = {'User-Agent': 'Mozilla/5.0 (research; ADP public archive)'}
SECTORS = {
    'natural_resources_mining': r'Natural resources\s*(?:[/&]|and)\s*mining',
    'construction': r'Construction', 'manufacturing': r'Manufacturing',
    'trade_transportation_utilities': r'Trade\s*[/,]\s*transportation\s*(?:/|,\s*(?:and\s+)?)\s*utilities',
    'information': r'Information', 'financial_activities': r'Financial activities',
    'professional_business_services': r'Professional\s*(?:[/&]|and)\s*business services',
    'education_health_services': r'Education\s*(?:[/&]|and)\s*health services',
    'leisure_hospitality': r'Leisure\s*(?:[/&]|and)\s*hospitality', 'other_services': r'Other services',
}

def get(url):
    response = requests.get(url, headers=HEADERS, timeout=45)
    response.raise_for_status()
    return BeautifulSoup(response.content, 'html.parser')

def index(offset):
    soup = get(f'https://mediacenter.adp.com/press-releases?o={offset}')
    return [(a.get_text(' ', strip=True), a.get('href')) for a in soup.select('a[href]')
            if 'ADP National Employment Report:' in a.get_text(' ', strip=True)]

def report(item):
    title, url = item
    match = re.search(r'/((?:202[2-6])-\d\d-\d\d)-', url)
    if not match: return None
    release = dt.date.fromisoformat(match.group(1))
    if release < dt.date(2022, 8, 31): return None
    soup = get(url)
    text = soup.get_text(' ', strip=True).replace('\xa0', ' ')
    match = re.search(r'Change by (?:Industry(?: Sector)?|Sector)(.*?)(?:Change by U\.S\. Regions|Change by Region)', text, re.I)
    if not match: return None
    section = match.group(1)
    values = {}
    for name, pattern in SECTORS.items():
        found = re.search(pattern + r'[^\d+\-]{0,30}([+\-]?\s*\d[\d,]*)', section, re.I)
        if found: values[name] = int(found.group(1).replace(',', '').replace(' ', ''))
    month = re.search(r'\bin (January|February|March|April|May|June|July|August|September|October|November|December)\b', title, re.I)
    if not month or len(values) != len(SECTORS): return None
    number = dt.datetime.strptime(month.group(1).title(), '%B').month
    year = release.year - (number > release.month)
    return year, number, release.isoformat(), url, values

def main():
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        pages = list(pool.map(index, range(0, 240, 5)))
    links = {url: (title, url) for page in pages for title, url in page}
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        reports = [x for x in pool.map(report, links.values()) if x]
    with sqlite3.connect(DB) as db:
        db.execute('CREATE TABLE IF NOT EXISTS adp_industry_first_release (reference_month TEXT NOT NULL, release_date TEXT NOT NULL, sector TEXT NOT NULL, value INTEGER NOT NULL, unit TEXT NOT NULL, source_url TEXT NOT NULL, PRIMARY KEY(reference_month, sector))')
        for year, month, released, url, values in reports:
            for sector, value in values.items():
                db.execute('INSERT OR IGNORE INTO adp_industry_first_release VALUES (?,?,?,?,?,?)', (f'{year:04d}-{month:02d}', released, sector, value, 'jobs', url))
        print('reports', len(reports), 'stored rows', db.execute('SELECT count(*) FROM adp_industry_first_release').fetchone()[0])
        print(db.execute('SELECT min(reference_month), max(reference_month), count(distinct reference_month) FROM adp_industry_first_release').fetchone())

if __name__ == '__main__': main()
