/** FleetOS shell styles (F301) — the single style module. */
export const STYLES = `
.fos-shell { min-height: 100vh; display: flex; flex-direction: column; font-family: ui-sans-serif, system-ui, sans-serif; background: #0b0f14; color: #dbe4ec; }
.fos-header { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 14px 22px; background: #101720; border-bottom: 1px solid #1d2a38; }
.fos-brand { display: flex; align-items: baseline; gap: 10px; }
.fos-logo { color: #e8a33d; font-size: 22px; }
.fos-title { font-size: 20px; font-weight: 700; letter-spacing: 0.04em; color: #f4f7fa; }
.fos-sub { font-size: 12px; color: #7c8ea0; }
.fos-session { display: flex; gap: 12px; }
.fos-switch { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #93a4b5; }
.fos-switch select { background: #16202b; color: #dbe4ec; border: 1px solid #263648; border-radius: 6px; padding: 4px 8px; }
.fos-nav { display: flex; flex-wrap: wrap; gap: 4px; padding: 10px 22px 0; background: #101720; border-bottom: 1px solid #1d2a38; }
.fos-nav-btn { background: transparent; color: #93a4b5; border: 0; border-bottom: 2px solid transparent; padding: 8px 12px; font-size: 13px; cursor: pointer; }
.fos-nav-btn:hover { color: #dbe4ec; }
.fos-nav-active { color: #e8a33d; border-bottom-color: #e8a33d; }
.fos-main { flex: 1; padding: 18px 22px; }
.fos-blurb { color: #7c8ea0; font-size: 12px; margin: 0 0 14px; }
.fos-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; }
.fos-card { background: #101720; border: 1px solid #1d2a38; border-radius: 10px; padding: 16px; }
.fos-span2 { grid-column: 1 / -1; }
.fos-card h2 { margin: 0 0 12px; font-size: 14px; color: #e8a33d; letter-spacing: 0.02em; }
.fos-list { list-style: none; margin: 0; padding: 0; font-size: 13px; }
.fos-list li { padding: 6px 8px; border-bottom: 1px solid #182532; }
.fos-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.fos-table th { text-align: left; color: #7c8ea0; font-weight: 500; padding: 4px 8px; border-bottom: 1px solid #1d2a38; }
.fos-table td { padding: 5px 8px; border-bottom: 1px solid #182532; }
.fos-counters { display: flex; gap: 22px; }
.fos-counters div { display: flex; flex-direction: column; }
.fos-counters b { font-size: 24px; color: #f4f7fa; }
.fos-counters span { font-size: 11px; color: #7c8ea0; }
.fos-digest { margin: 10px 0 0; font-size: 10.5px; color: #56697c; overflow-wrap: anywhere; }
.fos-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; }
.fos-refusal { background: #2a1512; border: 1px solid #5c2a22; color: #ffb4a6; border-radius: 8px; padding: 12px 14px; font-size: 13px; }
.fos-empty { background: #121a24; border: 1px dashed #263648; color: #7c8ea0; border-radius: 8px; padding: 14px; font-size: 13px; }
.fos-note { color: #7c8ea0; font-size: 12px; line-height: 1.5; }
.fos-form { display: grid; gap: 8px; max-width: 560px; }
.fos-form label { display: flex; align-items: center; gap: 10px; font-size: 12px; color: #93a4b5; }
.fos-form input { flex: 1; background: #16202b; color: #dbe4ec; border: 1px solid #263648; border-radius: 6px; padding: 6px 10px; font-family: ui-monospace, monospace; font-size: 12px; }
.fos-actions { display: flex; gap: 10px; }
.fos-actions button { background: #e8a33d; color: #101720; border: 0; border-radius: 6px; padding: 8px 14px; font-weight: 600; cursor: pointer; }
.fos-actions button:hover { background: #f4b455; }
.fos-result { margin: 10px 0 0; background: #121a24; border: 1px solid #263648; border-radius: 6px; padding: 10px; font-size: 12px; overflow-wrap: anywhere; }
.fos-ok { color: #8fd0a0; }
.fos-bad { color: #ff9d8f; }
.fos-footer { display: flex; justify-content: space-between; gap: 14px; flex-wrap: wrap; padding: 12px 22px; background: #101720; border-top: 1px solid #1d2a38; color: #56697c; font-size: 11px; }
.fos-commit code { color: #93a4b5; }
.fos-badge { font-size: 10px; color: #e8a33d; border: 1px solid #4a3c1d; border-radius: 4px; padding: 1px 6px; margin-left: 8px; vertical-align: middle; }
@media (max-width: 720px) { .fos-header { flex-direction: column; align-items: flex-start; } }
`;
