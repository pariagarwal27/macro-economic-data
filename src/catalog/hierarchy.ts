import { METRICS } from './metrics';

export type Region = 'US' | 'UK' | 'EA';
export type Node = { id: string; label: string; metricId?: string; children?: Node[] };

const metricIds = new Set(METRICS.map((m) => m.id));
const node = (id: string, label: string, metricId?: string, children?: Node[]): Node => ({ id, label, ...(metricId && metricIds.has(metricId) ? { metricId } : {}), ...(children ? { children } : {}) });

export const US_CPI_TREE: Node[] = [
  node('headline','Headline CPI','us-cpi'),
  node('food','Food','us-cpi-food',[
    node('food-home','Food at Home'), node('food-away','Food Away from Home'),
    node('cereal','Cereals & bakery products'), node('meat','Meats, poultry, fish & eggs'), node('fruit','Fruits & vegetables'), node('beverages','Nonalcoholic beverages'), node('other-food','Other food at home'),
  ]),
  node('energy','Energy','us-cpi-energy',[
    node('energy-commodities','Energy Commodities'), node('gasoline','Gasoline'), node('fuel-oil','Fuel oil'), node('other-motor','Other motor fuels'),
    node('energy-services','Energy Services'), node('electricity','Electricity'), node('utility-gas','Utility gas'),
  ]),
  node('core','Core CPI','us-cpi-core',[
    node('core-goods','Core Goods',undefined,[
      node('apparel','Apparel','us-cpi-apparel'), node('new-vehicles','New vehicles','us-cpi-new-vehicles'), node('used-cars','Used cars & trucks','us-cpi-used-cars'), node('furnishings','Household furnishings'), node('appliances','Appliances'), node('recreation-goods','Recreation goods','us-cpi-recreation-commodities'), node('other-goods','Other core goods','us-cpi-other-goods'),
    ]),
    node('core-services','Core Services',undefined,[
      node('shelter','Shelter','us-cpi-shelter',[node('rent','Rent of primary residence'),node('oer',"Owners' equivalent rent"),node('lodging','Lodging away from home'),node('insurance','Household insurance')]),
      node('medical','Medical Care','us-cpi-medical-services',[node('medical-commodities','Medical commodities','us-cpi-medical-commodities'),node('physicians',"Physicians' services"),node('hospital','Hospital services'),node('health-insurance','Health insurance')]),
      node('transport-services','Transportation Services','us-cpi-transport-services',[node('auto-insurance','Motor vehicle insurance'),node('airline','Airline fares'),node('maintenance','Motor vehicle maintenance'),node('public-transit','Public transportation')]),
      node('recreation-services','Recreation Services','us-cpi-recreation-services',[node('streaming','Cable / streaming'),node('admissions','Recreation admissions'),node('other-recreation','Other recreation services')]),
      node('education-services','Education & Communication','us-cpi-education-services',[node('education','Education'),node('telephone','Telephone services'),node('internet','Internet / communication')]),
      node('other-services','Other Services','us-cpi-other-services',[node('personal-care','Personal care'),node('financial','Financial services'),node('personal-services','Other personal services'),node('misc','Other miscellaneous services')]),
    ]),
  ]),
];

export const US_PCE_TREE: Node[] = [
  node('headline','Headline PCE','us-pce',[
    node('goods','Goods','us-pce-goods',[
      node('durable','Durable goods','us-pce-durable-goods',[
        node('motor-vehicles','Motor vehicles and parts'),
        node('furnishings','Furnishings and durable household equipment','us-pce-furnishings'),
        node('recreational-goods','Recreational goods and vehicles'),
        node('other-durable','Other durable goods'),
      ]),
      node('nondurable','Nondurable goods',undefined,[
        node('food','Food and beverages purchased for off-premises consumption','us-pce-food'),
        node('clothing','Clothing and footwear','us-pce-clothing'),
        node('energy-goods','Gasoline and other energy goods','us-pce-energy'),
        node('other-nondurable','Other nondurable goods'),
      ]),
    ]),
    node('services','Services','us-pce-services',[
      node('household','Household consumption expenditures for services','us-pce-household-services',[
        node('housing','Housing','us-pce-housing'),
        node('healthcare','Health care','us-pce-healthcare'),
        node('transportation-services','Transportation services'),
        node('recreation-services','Recreation services'),
        node('food-services','Food services and accommodations','us-pce-food-services'),
        node('financial-services','Financial services and insurance'),
        node('other-services','Other services'),
      ]),
    ]),
  ]),
  node('related-measures','Related aggregate (not a headline component)',undefined,[
    node('core','Core PCE (excludes food and energy)','us-core-pce'),
  ]),
];

export const UK_INFLATION_TREE: Node[] = [
  node('cpi','CPI','uk-cpi-yoy'), node('cpih','CPIH','uk-cpih-yoy'),
  node('01','01 Food & non-alcoholic beverages','uk-food-cpi-yoy'), node('02','02 Alcoholic beverages & tobacco'), node('03','03 Clothing & footwear'), node('04','04 Housing & household services','uk-housing-cpi-yoy'), node('05','05 Furniture & household goods'), node('06','06 Health'), node('07','07 Transport'), node('08','08 Communication'), node('09','09 Recreation & culture'), node('10','10 Education'), node('11','11 Restaurants & hotels'), node('12','12 Miscellaneous goods & services'),
];

export const EA_INFLATION_TREE: Node[] = [
  node('food','Food, alcohol & tobacco','ea-food-hicp-yoy',[node('unprocessed','Unprocessed food'),node('processed','Processed food / alcohol / tobacco')]),
  node('energy','Energy','ea-energy-hicp-yoy',[node('gas','Gas'),node('electricity','Electricity'),node('fuels','Fuels'),node('heat','Heat')]),
  node('goods','Non-energy industrial goods','ea-goods-hicp-yoy',[node('durable','Durable'),node('semi','Semi-durable'),node('non-durable','Non-durable')]),
  node('services','Services','ea-services-hicp-yoy',[node('housing','Housing'),node('transport','Transport'),node('communication','Communication'),node('recreation','Recreation'),node('misc','Misc.')]),
];

export const INFLATION_TREES: Record<Region, Node[]> = { US: US_CPI_TREE, UK: UK_INFLATION_TREE, EA: EA_INFLATION_TREE };

export const COUNTRY_META = {
  US: { name: 'United States', flag: '🇺🇸', source: 'BLS / BEA' },
  UK: { name: 'United Kingdom', flag: '🇬🇧', source: 'ONS' },
  EA: { name: 'Euro Area', flag: '🇪🇺', source: 'Eurostat' },
} as const;

export const KEY_INDICATOR_IDS: Record<Region,string[]> = { US: ['us-cpi','us-cpi-core','us-core-pce','us-gdp-real','us-nfp','us-unemployment','us-ahe'], UK: ['uk-cpi-yoy','uk-core-cpi-yoy','uk-gdp-qoq','uk-gdp-yoy','uk-unemployment','uk-vacancies','uk-awe-regular-yoy'], EA: ['ea-hicp-yoy','ea-core-hicp-yoy','ea-gdp-qoq','ea-gdp-yoy','ea-unemployment','ea-employment-yoy','ea-wage-growth'] };

export const HEADLINE_IDS: Record<Region, Record<'inflation'|'growth'|'jobs', string[]>> = {
  US: { inflation: ['us-cpi','us-cpi-core','us-core-pce'], growth: ['us-gdp-real','us-personal-spending','us-industrial-production'], jobs: ['us-nfp','us-unemployment','us-participation','us-ahe'] },
  UK: { inflation: ['uk-cpi-yoy','uk-cpih-yoy','uk-core-cpi-yoy','uk-services-cpi-yoy'], growth: ['uk-gdp-qoq','uk-gdp-yoy','uk-gdp-mom','uk-industrial-production'], jobs: ['uk-unemployment','uk-employment-level','uk-vacancies','uk-awe-regular-yoy'] },
  EA: { inflation: ['ea-hicp-yoy','ea-core-hicp-yoy','ea-hicp-mom','ea-services-hicp-yoy'], growth: ['ea-gdp-qoq','ea-gdp-yoy','ea-industrial-production','ea-retail-sales'], jobs: ['ea-unemployment','ea-employment-yoy','ea-youth-unemployment','ea-wage-growth'] },
};
