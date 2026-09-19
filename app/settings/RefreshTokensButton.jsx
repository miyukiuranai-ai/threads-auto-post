'use client';

import { useActionState } from 'react';
import { refreshAllTokens } from '../_actions/accounts';
import SubmitButton from '../_components/SubmitButton';

const initial = { ok: null, error: null };

export default function RefreshTokensButton() {
  const [state, action] = useActionState(async () => refreshAllTokens(), initial);
  return (
    <form action={action} className="field-row">
      <SubmitButton className="btn" pendingLabel="延長中…" title="発行から24時間以上経ったトークンを、いま60日に延ばします">
        全名義のトークンをいま延長する
      </SubmitButton>
      {state.error && <span className="over">{state.error}</span>}
      {state.ok && <span className="ok-text">{state.ok}</span>}
    </form>
  );
}
