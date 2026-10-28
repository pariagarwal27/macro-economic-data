type Reading = {
  name: string;
  color: string;
  yoy?: number | null;
  mom?: number | null;
  trend?: number | null;
};

export function RetailSalesTooltip({ date, readings, columns, formatValue }: {
  date: string;
  readings: Reading[];
  columns: Array<{ key: "yoy" | "mom" | "trend"; label: string }>;
  formatValue: (value: number) => string;
}) {
  return <div className="retail-sales-tooltip">
    <strong className="retail-sales-tooltip-date">Date: {date}</strong>
    <table aria-label="Retail sales readings">
      <thead><tr><th scope="col">Series</th>{columns.map(column => <th key={column.key} scope="col">{column.label}</th>)}</tr></thead>
      <tbody>{readings.map(reading => <tr key={reading.name}>
        <th scope="row"><i aria-hidden="true" style={{ background: reading.color }} />{reading.name}</th>
        {columns.map(column => { const value = reading[column.key]; return <td key={column.key}>{value == null || !Number.isFinite(value) ? "—" : formatValue(value)}</td>; })}
      </tr>)}</tbody>
    </table>
  </div>;
}
