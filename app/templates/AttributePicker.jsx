'use client';

import { useState } from 'react';

/**
 * その文章を使わせる属性を選ぶ欄。
 * 何も選ばなければ「どの名義でも使う」。選ぶと、その属性の名義だけが使う。
 */
export default function AttributePicker({ choices, initial = [], name = 'attributes', disabled = false, compact = false }) {
  const [selected, setSelected] = useState(() => new Set(initial));

  function toggle(value) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  return (
    <div className="attr-picker">
      <div className="check-grid">
        {choices.map((c) => (
          <label key={c} className="check-cell" data-checked={selected.has(c)}>
            <input type="checkbox" name={name} value={c} checked={selected.has(c)} onChange={() => toggle(c)} disabled={disabled} />
            <span>{c}</span>
          </label>
        ))}
      </div>
      {!compact && (
        <small className="stat-note">
          {selected.size === 0
            ? '選ばないままなら、どの名義でも使う文章になります（属性を問わない文言はこのままで構いません）。'
            : `「${[...selected].join('・')}」の属性を付けた名義だけが、この文章を使います。`}
        </small>
      )}
    </div>
  );
}
