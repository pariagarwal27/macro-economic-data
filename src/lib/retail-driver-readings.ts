type Point = {date:string;value:number;rawValue?:number|null};
type Metrics = Record<string,{history:Point[]}|undefined>;
export function retailDriverRate(metrics:Metrics,id:string,measure:'mom'|'yoy',period:string):number|null {
  if (id === 'us-retail-sales-control-group') {
    const control = metrics[id]?.history?.find(point => point.date.slice(0,7) === period);
    if (control) return Number.isFinite(control.value) ? control.value : null;
    const ids = ['us-retail-sales-total','us-retail-motor-vehicles','us-retail-gasoline','us-retail-total-ex-auto-gas','us-retail-food-services'];
    const rates = ids.map(seriesId => retailDriverRate(metrics,seriesId,measure,period));
    if (rates.some(value => value == null)) return null;
    return rates[0]! - rates[1]! - rates[2]! - rates[3]! - rates[4]!;
  }
  const publishedYoy = id === 'uk-retail-sales-total-ex-fuel' ? 'uk-retail-sales-total-yoy' : id === 'uk-retail-sales-ex-fuel' ? 'uk-retail-sales-ex-fuel-yoy' : null;
  const history = metrics[measure === 'yoy' && publishedYoy ? publishedYoy : id]?.history ?? [];
  const point = history.find(point => point.date.slice(0,7) === period);
  if (!point) return null;
  if (measure === 'mom' || publishedYoy) return Number.isFinite(point.value) ? point.value : null;
  const yearAgo = `${Number(period.slice(0,4))-1}${period.slice(4)}`;
  const base = history.find(point => point.date.slice(0,7) === yearAgo)?.rawValue;
  return point.rawValue != null && base != null && base !== 0 ? (point.rawValue/base-1)*100 : null;
}
