import type { ConfigField } from "@/connectors/catalog";

const INPUT_CLS = "w-full rounded-md border border-neutral-300 px-3 py-2 text-sm";

/**
 * Renders one connector config field with a proper label. A field with `options`
 * becomes a dropdown; otherwise a text input whose placeholder is the catalog's
 * *example* (e.g. `1AbC…`), never the label — so an empty field never looks
 * pre-filled. Used by both the connect form and the connection config editor.
 */
export function ConfigFieldInput({ field, defaultValue }: { field: ConfigField; defaultValue?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">
        {field.label}
        {field.required && <span className="text-red-500"> *</span>}
      </span>
      {field.options && field.options.length > 0 ? (
        <select name={`cfg_${field.key}`} defaultValue={defaultValue ?? ""} required={field.required} className={INPUT_CLS}>
          {!field.required && <option value="">—</option>}
          {field.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          name={`cfg_${field.key}`}
          defaultValue={defaultValue}
          placeholder={field.placeholder}
          required={field.required}
          className={INPUT_CLS}
        />
      )}
      {field.hint && <span className="mt-1 block text-xs text-neutral-400">{field.hint}</span>}
    </label>
  );
}
