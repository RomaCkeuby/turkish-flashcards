type FilterName = "category" | "partOfSpeech" | "tag";
export function StudyFilterFields({ options, values, onChange, disabled = false }: {
  options: { categories: string[]; partsOfSpeech: string[]; tags: string[] };
  values: Record<FilterName, string>; onChange: (name: FilterName, value: string) => void; disabled?: boolean;
}) {
  const fields = [
    { name: "category", label: "Категория", options: options.categories },
    { name: "partOfSpeech", label: "Часть речи", options: options.partsOfSpeech },
    { name: "tag", label: "Тег", options: options.tags },
  ] as const;
  return <>{fields.map(field => <label className="statusFilter" key={field.name}><span>{field.label}</span>
    <select value={values[field.name]} disabled={disabled} onChange={event => onChange(field.name, event.target.value)}>
      <option value="">Все</option>{field.options.map(value => <option key={value}>{value}</option>)}
    </select>
  </label>)}</>;
}
