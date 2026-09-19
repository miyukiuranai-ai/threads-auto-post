'use client';

import { useActionState, useState } from 'react';
import { applySchedule } from '../_actions/schedule';
import SubmitButton from '../_components/SubmitButton';
import AccountPicker from '../_components/AccountPicker';

const initial = { ok: null, error: null };

const hoursOf = (minutes) => {
  const h = minutes / 60;
  return Number.isInteger(h) ? String(h) : h.toFixed(1).replace(/\.0$/, '');
};

/** 名義の設定をフォームの値にする。 */
function formOf(schedule) {
  const s = schedule ?? {};
  return {
    dailyEnabled: Boolean(s.dailyEnabled),
    dailyTimes: (s.dailyTimes ?? []).join(', '),
    intervalEnabled: Boolean(s.intervalEnabled),
    intervalMinHours: hoursOf(s.intervalMinMinutes ?? 180),
    intervalMaxHours: hoursOf(s.intervalMaxMinutes ?? 360),
    activeFrom: s.activeFrom ?? '07:00',
    activeTo: s.activeTo ?? '23:00',
    order: s.order ?? 'random',
    source: s.source ?? 'both',
    tag: s.tag ?? '',
    minGapMinutes: String(s.minGapMinutes ?? 30),
  };
}

/**
 * 自動投稿の設定を、選んだ名義にまとめて入れる。
 * 名義の一覧の「この設定を読み込む」を押すと、その名義の値がフォームに入る。
 */
export default function ScheduleEditor({ accounts, tags, loadFrom }) {
  const [state, action] = useActionState(async (_p, fd) => applySchedule(fd), initial);
  const source = loadFrom ? accounts.find((a) => a.id === loadFrom) : null;
  const [form, setForm] = useState(() => formOf(source?.schedule));
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));

  return (
    <form action={action}>
      <section className="card">
        <div className="card-head">
          <div className="card-title">1. どの名義に入れるか</div>
        </div>
        <AccountPicker accounts={accounts} initial={source ? [source.id] : []} hint="複数選ぶと、同じ設定がまとめて入ります。名義ごとに変えたいときは1つずつ選んで入れてください。" />
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">
            2. 毎日決まった時刻に投稿する
            {source && <small>（@{source.name} の設定を読み込んでいます）</small>}
          </div>
        </div>
        <label className="check">
          <input type="checkbox" name="dailyEnabled" checked={form.dailyEnabled} onChange={set('dailyEnabled')} />
          毎日の決まった時刻に投稿する
        </label>
        <label className="field" style={{ marginTop: 12 }}>
          <span>時刻（日本時間。複数はカンマで区切る）</span>
          <input name="dailyTimes" value={form.dailyTimes} onChange={set('dailyTimes')} placeholder="例: 07:00, 12:30, 21:00" disabled={!form.dailyEnabled} />
          <small>その時刻を過ぎた最初の定期実行（5分おき）で投稿されます。1時間以上遅れたら見送ります。</small>
        </label>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">3. 〇時間から〇時間おきに投稿する</div>
        </div>
        <label className="check">
          <input type="checkbox" name="intervalEnabled" checked={form.intervalEnabled} onChange={set('intervalEnabled')} />
          決まった間隔でも投稿する（間隔は毎回ランダムに決まる）
        </label>
        <div className="field-row" style={{ marginTop: 12 }}>
          <input type="number" name="intervalMinHours" value={form.intervalMinHours} onChange={set('intervalMinHours')} min="0.25" step="0.25" className="inline-input" disabled={!form.intervalEnabled} />
          <span>時間 から</span>
          <input type="number" name="intervalMaxHours" value={form.intervalMaxHours} onChange={set('intervalMaxHours')} min="0.25" step="0.25" className="inline-input" disabled={!form.intervalEnabled} />
          <span>時間 おき</span>
        </div>
        <div className="field-row" style={{ marginTop: 12 }}>
          <span>投稿する時間帯</span>
          <input type="time" name="activeFrom" value={form.activeFrom} onChange={set('activeFrom')} className="inline-input" disabled={!form.intervalEnabled} />
          <span>〜</span>
          <input type="time" name="activeTo" value={form.activeTo} onChange={set('activeTo')} className="inline-input" disabled={!form.intervalEnabled} />
          <small className="stat-note">この外の時刻に当たったら、次の開始時刻まで待ちます。同じ時刻にすると終日。</small>
        </div>
        <div className="stat-note" style={{ marginTop: 10 }}>
          例: 「2 時間から 5 時間おき、07:00〜23:00」にすると、前の投稿から 2〜5 時間後（毎回ランダム）に次の投稿が出ます。夜は止まり、朝 7 時台に再開します。
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div className="card-title">4. 文章の選び方</div>
        </div>
        <div className="field-grid">
          <label className="field">
            <span>順番</span>
            <select name="order" value={form.order} onChange={set('order')}>
              <option value="random">ランダム（一巡するまで同じ文章を出さない）</option>
              <option value="sequential">登録順</option>
            </select>
            <small>どちらも全部使い切ったら最初から繰り返します。</small>
          </label>
          <label className="field">
            <span>使うストック</span>
            <select name="source" value={form.source} onChange={set('source')}>
              <option value="both">この名義用 ＋ 全名義共通</option>
              <option value="own">この名義用だけ</option>
              <option value="shared">全名義共通だけ</option>
            </select>
          </label>
          <label className="field">
            <span>タグで絞る（任意）</span>
            <input name="tag" value={form.tag} onChange={set('tag')} list="schedule-tags" placeholder="空なら絞らない" />
            <datalist id="schedule-tags">
              {tags.map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>直前の投稿からあける最低の分数</span>
            <input type="number" name="minGapMinutes" value={form.minGapMinutes} onChange={set('minGapMinutes')} min="0" max="1440" />
            <small>予約投稿や今すぐ投稿の直後に自動投稿が重ならないようにします。</small>
          </label>
        </div>

        <div className="editor-foot">
          <span>
            {state.error && <span className="over">{state.error}</span>}
            {state.ok && <span className="ok-text">{state.ok}</span>}
          </span>
          <SubmitButton className="btn btn-primary btn-lg" pendingLabel="保存中…">
            選んだ名義に適用する
          </SubmitButton>
        </div>
      </section>
    </form>
  );
}
