// Inline style objects shared across the Kōdo WebView components.
export const styles = {
  root: {
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    fontSize: 'var(--vscode-editor-font-size, 13px)',
    background: 'var(--vscode-editor-background)',
    color: 'var(--vscode-editor-foreground)',
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    padding: '12px',
    boxSizing: 'border-box',
  },
  attachBtn: {
    background: 'transparent',
    color: '#c8a400',
    border: '1px solid #c8a400',
    borderRadius: '2px',
    cursor: 'pointer',
    fontSize: '16px',
    fontWeight: 'bold',
    flexShrink: 0,
  },
  reconnectBtn: {
    background: 'transparent',
    color: '#c8a400',
    border: '1px solid #c8a400',
    borderRadius: '2px',
    cursor: 'pointer',
    fontSize: '16px',
    flexShrink: 0,
  },
  // The single attachment row under the textarea in the composer's centre
  // column. Its height is reserved whether or not anything is attached, so
  // the textarea doesn't jump when the first chip lands. One row only: chips
  // shrink (names ellipsize) instead of wrapping, so every attachment stays
  // on screen. `overflowX: auto` is the last resort for a centre column too
  // narrow even for the squeezed chips — scrolling beats clipping an
  // attachment out of reach of its 🗑.
  attachArea: {
    flex: '0 0 auto',
    minWidth: 0,
    height: '22px',
    marginTop: '6px',
    display: 'flex',
    flexWrap: 'nowrap' as const,
    alignItems: 'center',
    gap: '4px',
    overflowX: 'auto' as const,
    overflowY: 'hidden' as const,
  },
  attachChip: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    // Shrinkable: 140px when there is room, squeezed (name ellipsized by
    // attachChipName) when the row holds more chips than it can fit.
    flex: '0 1 auto',
    minWidth: '28px',
    maxWidth: '140px',
    boxSizing: 'border-box' as const,
    padding: '2px 6px',
    border: '1px solid #c8a400',
    borderRadius: '6px',
    background: 'transparent',
    fontSize: '11px',
    height: '22px',
  },
  attachChipName: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  attachChipRemove: {
    flexShrink: 0,
    cursor: 'pointer',
    fontSize: '11px',
    lineHeight: 1,
  },
  globalStopBtn: {
    background: 'transparent',
    color: 'var(--vscode-errorForeground)',
    border: '1px solid var(--vscode-errorForeground)',
    borderRadius: '2px',
    cursor: 'pointer',
    fontSize: '16px',
    flexShrink: 0,
  },
  deleteBtn: {
    background: 'transparent',
    color: 'var(--vscode-errorForeground)',
    border: '1px solid var(--vscode-errorForeground)',
    borderRadius: '2px',
    cursor: 'pointer',
    fontSize: '16px',
    flexShrink: 0,
  },
  resumeBanner: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'var(--vscode-notifications-background, var(--vscode-editor-background))',
    border: '1px solid var(--vscode-focusBorder)',
    borderRadius: '4px',
    padding: '6px 10px',
    marginBottom: '6px',
    fontSize: '12px',
  },
  resumeText: { flex: 1 },
  resumeBtn: {
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    borderRadius: '2px',
    padding: '3px 10px',
    cursor: 'pointer',
    fontSize: '11px',
    fontWeight: 'bold',
    flexShrink: 0,
  },
  resumeDismissBtn: {
    background: 'transparent',
    color: 'var(--vscode-descriptionForeground)',
    border: 'none',
    cursor: 'pointer',
    fontSize: '11px',
    flexShrink: 0,
  },
  throttleToast: {
    position: 'fixed',
    top: '10px',
    left: '12px',
    right: '12px',
    zIndex: 1000,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    background: 'var(--vscode-notifications-background, var(--vscode-editor-background))',
    border: '1px solid var(--vscode-notificationsWarningIcon-foreground, var(--vscode-focusBorder))',
    borderRadius: '4px',
    padding: '8px 10px',
    fontSize: '12px',
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.35)',
  },
  throttleToastText: { flex: 1 },
  throttleToastCloseBtn: {
    background: 'transparent',
    color: 'var(--vscode-descriptionForeground)',
    border: 'none',
    cursor: 'pointer',
    fontSize: '14px',
    lineHeight: 1,
    padding: '2px 4px',
    flexShrink: 0,
  },
  pingBtn: {
    background: 'var(--vscode-button-secondaryBackground, var(--vscode-button-background))',
    color: 'var(--vscode-button-secondaryForeground, var(--vscode-button-foreground))',
    border: 'none',
    borderRadius: '2px',
    padding: '2px 8px',
    cursor: 'pointer',
    fontSize: '11px',
  },
  pongLine: {
    color: 'var(--vscode-descriptionForeground)',
    fontSize: '11px',
    marginBottom: '4px',
  },
  usagePanel: {
    fontSize: '11px',
    color: 'var(--vscode-descriptionForeground)',
    marginBottom: '6px',
    padding: '4px 0',
    borderBottom: '1px solid var(--vscode-panel-border)',
  },
  usageName: { marginBottom: '2px', color: 'var(--vscode-foreground)' },
  usageStatsLine: { display: 'flex', alignItems: 'center', flexWrap: 'wrap' as const, gap: '2px' },
  usageTotals: { fontVariantNumeric: 'tabular-nums' },
  usageDetail: { opacity: 0.8 },
  compactBtn: {
    marginLeft: '8px',
    background: 'transparent',
    color: 'var(--vscode-textLink-foreground)',
    border: '1px solid var(--vscode-textLink-foreground)',
    borderRadius: '2px',
    padding: '1px 8px',
    cursor: 'pointer',
    fontSize: '10px',
    flexShrink: 0,
  },
  compactBtnDisabled: {
    marginLeft: '8px',
    background: 'transparent',
    color: 'var(--vscode-descriptionForeground)',
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: '2px',
    padding: '1px 8px',
    cursor: 'default',
    fontSize: '10px',
    opacity: 0.6,
    flexShrink: 0,
  },
  // Left column of the composer (composerRow): the Agent button
  // (AgentButton.tsx), the Session Parameters button (ModeControls.tsx, which
  // holds the four remaining per-session controls that used to be a stack of
  // five cycling toggles before Agent had its own popup), and Sampling
  // Parameters.
  sessionCol: {
    // 290px = SESSION_BTN_WIDTH (242px) + 24px of slack either side. This used
    // to equal composerRight's own fixed 240px (both were "the same
    // COMPOSER_SIDE_WIDTH"), but the two were deliberately decoupled when the
    // buttons were widened by 50px to fit "Agent: <name>" without truncating —
    // composerRight's own 56px-glyph buttons had no such problem and were left
    // at 240px, so only this column grew. `composerCenter`'s `flex: 1 1 auto`
    // absorbs the extra 50px on its own, and the 24px-of-slack symmetry with
    // composerRight's inset (see that key's comment) is preserved because both
    // the column and the buttons inside it grew by the same 50px — see
    // `sessionBtn`.
    flex: '0 0 290px',
    boxSizing: 'border-box' as const,
    // COMPOSER_GRID_HEIGHT: deliberately the same height as composerRight's
    // button grid (3 rows of 32px + 2 gaps of 8px = 112px), written as the same
    // arithmetic so it survives a change to either. Both outer columns are
    // bottom-anchored by composerRow's `alignItems: flex-end`, so pinning this
    // height is what keeps the Session button level with the ↑ / + / 📂 row —
    // and, crucially, what stops it moving when the textarea grows upward. A
    // column sized by its content would ride the row's top edge instead.
    height: 'calc(3 * 32px + 2 * 8px)',
    display: 'flex',
    flexDirection: 'column' as const,
    // The three buttons — Agent, Session Parameters, Sampling Parameters —
    // are 32px tall with an 8px gap, i.e. exactly composerRight's
    // row track and row gap, so 3 × 32 + 2 × 8 fills this 112px box precisely
    // and each left button sits level with the grid row beside it. There is no
    // paddingRight (the old toggle column had one to line its ⓘ markers up with
    // the right column's inset): the 242px buttons are centred in the 290px
    // column, leaving 24px of slack either side, which is exactly the inset
    // composerRight uses — that symmetry is the point, and is why the column
    // grew by the same 50px as the buttons rather than only the buttons.
    justifyContent: 'flex-start' as const,
    alignItems: 'center' as const,
    gap: '8px',
  },
  // Wraps only the button, and is the popup's positioning context: the popup is
  // absolutely placed against *this* box, so its bottom-left corner meets the
  // button's top-left corner whatever the column around it does.
  sessionBtnWrap: {
    position: 'relative' as const,
    // SESSION_BTN_WIDTH — must equal `sessionBtn`'s own width (this element
    // wraps one of them: Agent and Session Parameters each anchor a popup).
    // 242px = the original 192px + 50px, widened so "Agent: <name>" fits
    // without ellipsis-truncating for the longer built-in agent names. It must
    // stay under the column's 290px — `sessionCol` centres it, and the popup's
    // maxWidth below is derived from the slack either side.
    width: '242px',
    flex: 'none' as const,
  },
  sessionBtn: {
    // SESSION_BTN_WIDTH, stated outright rather than as `100%`: one of the
    // three buttons that uses this style (Sampling Parameters) sits directly
    // in `sessionCol` (a 290px flex column), where `100%` would stretch it to
    // 290px. Agent and Session Parameters are each wrapped in a 242px
    // `sessionBtnWrap` instead, since each anchors its own popup.
    width: '242px',
    // Matches composerRight's 32px grid row, so the three left buttons line up
    // with the three button rows across the textarea.
    height: '32px',
    boxSizing: 'border-box' as const,
    padding: '0 8px',
    // 14px: the right-hand grid's 16px is tuned for a lone glyph, these buttons
    // carry words.
    fontSize: '14px',
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    cursor: 'pointer',
    // The neutral, grey-bordered treatment the ⚙ and 🎛 buttons used to carry in
    // the right-hand grid, inherited when those two moved into this column as
    // (former) "Kōdo Settings" and "Sampling Parameters": transparent ground,
    // descriptionForeground for both text and border. It reads as "opens a
    // surface" rather than "acts on the session", which is what all three of
    // these buttons do — and it sets them apart from the coloured, session-
    // acting buttons on the right (green send, yellow attach, red stop/delete).
    // This is now the only definition of that palette; `samplingBtn` and
    // `kodoSettingsBtn` were deleted with the buttons that used them.
    background: 'transparent',
    color: 'var(--vscode-descriptionForeground)',
    border: '1px solid var(--vscode-descriptionForeground)',
    borderRadius: '2px',
  },
  // Greyed-out look while the session is disconnected — the popup's contents
  // would all be unactionable, so the button itself refuses to open.
  sessionBtnDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed' as const,
  },
  // The popup itself. `bottom: 100%` + `left: 0` put its bottom-left edge flush
  // against the button's top-left edge (the requested anchoring), and it opens
  // upward because the composer sits at the bottom of the WebView. `maxHeight`
  // is NOT set here: ModeControls measures the space actually available above
  // the button on open and applies it inline, so a short panel scrolls the menu
  // instead of letting it escape off the top of the view.
  sessionMenu: {
    position: 'absolute' as const,
    bottom: '100%',
    left: 0,
    // 960px — three times the original 320px, at the user's request, so the
    // option descriptions get a comfortable measure instead of wrapping every
    // few words.
    width: '960px',
    // The popup's left edge sits at the button's left edge, which is 36px into
    // the viewport (12px of `root` padding + 24px of slack left of the 242px
    // button inside the 290px column) — unchanged by the 50px widening, since
    // both grew together and centring keeps the slack itself fixed at 24px. So
    // cap on that offset plus a 12px right margin, not on a blanket `90vw` —
    // which would overhang the right edge of a narrow panel. Re-derive this if
    // the button's width changes without the column also growing to match.
    maxWidth: 'calc(100vw - 48px)',
    boxSizing: 'border-box' as const,
    overflowY: 'auto' as const,
    padding: '6px 0',
    textAlign: 'left' as const,
    fontSize: '13px',
    background: 'var(--vscode-menu-background, var(--vscode-editorWidget-background))',
    color: 'var(--vscode-menu-foreground, var(--vscode-editorWidget-foreground))',
    border: '1px solid var(--vscode-menu-border, var(--vscode-widget-border))',
    borderRadius: '4px',
    boxShadow: '0 2px 8px var(--vscode-widget-shadow, rgba(0, 0, 0, 0.35))',
    zIndex: 1000,
  },
  // "## Agent", "## Mode", … — one row per single-choice group heading, holding
  // the title and, to its right on the SAME line, the group's status/lock note.
  //
  // The note sharing this line is the whole point of the row: it appears and
  // disappears as session state changes (a turn starts, Autonomous is toggled,
  // the model changes), and on its own line that would add and remove height,
  // making the menu jump under the pointer. `lineHeight` is pinned here and
  // inherited by both children so the row is exactly one line tall whether or
  // not a note is present.
  sessionGroupHeader: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '10px',
    padding: '4px 12px 2px',
    fontSize: '11px',
    lineHeight: '15px',
    opacity: 0.75,
  },
  // The title itself. The uppercase/letter-spacing treatment lives here rather
  // than on the row, so the note beside it is NOT uppercased.
  sessionGroupTitle: {
    flex: 'none' as const,
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  // The status/lock note: "Queued for the next prompt — currently X.",
  // "Locked to Allow All while Autonomous mode is in effect.", "This LLM does
  // not have thinking mode." Rendered only when there is something to say.
  //
  // `nowrap` + ellipsis (with `minWidth: 0` to let the flex item actually
  // shrink) is the guard that keeps the no-jump promise: a note too long for
  // the row truncates instead of wrapping onto a second line. At the popup's
  // 960px there is ~800px spare, so no current note comes close.
  sessionGroupNote: {
    flex: '0 1 auto' as const,
    minWidth: 0,
    fontStyle: 'italic' as const,
    whiteSpace: 'nowrap' as const,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  // Separator between two groups, matching the `---` rules in the design.
  sessionGroupDivider: {
    border: 'none',
    borderTop: '1px solid var(--vscode-menu-separatorBackground, var(--vscode-widget-border))',
    margin: '5px 0',
  },
  // One radio row: the ◉/○ marker, then the option name over its description.
  // A <button>, so it is clickable and focusable without any extra handling.
  sessionOption: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: '8px',
    width: '100%',
    boxSizing: 'border-box' as const,
    padding: '4px 12px 5px',
    border: 'none',
    borderRadius: 0,
    background: 'transparent',
    color: 'inherit',
    font: 'inherit',
    textAlign: 'left' as const,
    cursor: 'pointer',
  },
  // Hover highlight. VS Code webviews give inline styles no `:hover` to lean
  // on, so ModeControls tracks it per row in state — the same trick
  // FooterButton uses for `:active`.
  sessionOptionHover: {
    background: 'var(--vscode-menu-selectionBackground, var(--vscode-list-hoverBackground))',
    color: 'var(--vscode-menu-selectionForeground, inherit)',
  },
  // A row in a group that cannot currently be changed (Edit/Tool Control under
  // Autonomous, Thinking on a model with no tiers, anything while
  // disconnected). Still shows which option is selected — the group note says
  // why it is fixed.
  sessionOptionDisabled: {
    opacity: 0.5,
    cursor: 'default' as const,
  },
  sessionRadio: {
    flex: 'none' as const,
    width: '12px',
    fontSize: '11px',
    lineHeight: '17px',
  },
  sessionOptionLabel: {
    fontSize: '13px',
    lineHeight: '17px',
  },
  sessionOptionDesc: {
    marginTop: '1px',
    fontSize: '11px',
    lineHeight: 1.35,
    opacity: 0.75,
  },
  stream: {
    flex: 1,
    overflowY: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    borderTop: '1px solid var(--vscode-panel-border)',
    paddingTop: '8px',
    marginBottom: '8px',
    minHeight: '80px',
  },
  /** "Show Timestamps" line rendered above a user_message/assistant_response/
   *  tool_call block (App.tsx/SessionEntryView.tsx) — deliberately small and
   *  low-contrast so it never competes with the content it labels; its own
   *  top margin carries the block's usual "gap from whatever came before"
   *  spacing, with almost none below so it reads as attached to the block
   *  underneath it. */
  timestampLine: {
    fontSize: '11px',
    color: 'var(--vscode-descriptionForeground)',
    marginTop: '14px',
    marginBottom: '2px',
  },
  userPrompt: {
    // Chat bubble pinned to the right edge (marginLeft:auto), sized to a fixed
    // share of the WebView width rather than shrinking to fit its content.
    background: 'var(--vscode-input-background)',
    // Yellow-ish accent matching the active prompt edit box / attach-file chips.
    border: '1px solid #c8a400',
    borderRadius: '6px',
    padding: '12px 20px',
    marginTop: '40px',
    marginBottom: '40px',
    marginLeft: 'auto',
    width: '80%',
    boxSizing: 'border-box' as const,
    color: 'var(--vscode-input-foreground)',
    // Match the agent-response font (inherited editor font), one notch larger.
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    fontSize: 'calc(var(--vscode-editor-font-size, 13px) + 2px)',
    textAlign: 'left',
  },
  userPromptText: {
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  userPromptAttachments: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '4px',
    justifyContent: 'flex-start',
    marginTop: '8px',
  },
  sentAttachChip: {
    display: 'flex',
    alignItems: 'center',
    gap: '4px',
    maxWidth: '160px',
    boxSizing: 'border-box' as const,
    padding: '2px 8px',
    border: '1px solid #c8a400',
    borderRadius: '6px',
    background: 'transparent',
    fontSize: '11px',
    height: '22px',
    cursor: 'pointer',
    textAlign: 'left' as const,
  },
  sentAttachIcon: {
    flexShrink: 0,
    fontSize: '11px',
    lineHeight: 1,
  },
  agentTokens: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  mdRoot: {
    whiteSpace: 'normal' as const,
    wordBreak: 'break-word' as const,
    lineHeight: 1.5,
  },
  mdP: {
    margin: '0.4em 0',
  },
  mdHeadingBase: {
    fontWeight: 600,
    lineHeight: 1.3,
    margin: '0.6em 0 0.3em',
  },
  mdBold: {
    fontWeight: 600,
  },
  mdCode: {
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    fontSize: '0.9em',
    background: 'var(--vscode-textCodeBlock-background, rgba(127,127,127,0.18))',
    padding: '0.1em 0.3em',
    borderRadius: '3px',
  },
  mdPreWrap: {
    position: 'relative' as const,
    margin: '0.5em 0',
  },
  mdPre: {
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    fontSize: '0.9em',
    background: 'var(--vscode-textCodeBlock-background, rgba(127,127,127,0.12))',
    padding: '8px 10px',
    borderRadius: '4px',
    overflowX: 'auto' as const,
    margin: 0,
    whiteSpace: 'pre' as const,
  },
  mdCopyBtn: {
    position: 'absolute' as const,
    top: '6px',
    right: '6px',
    background: 'var(--vscode-editor-background)',
    color: 'var(--vscode-descriptionForeground)',
    border: '1px solid var(--vscode-descriptionForeground)',
    borderRadius: '2px',
    width: '24px',
    height: '24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    fontSize: '12px',
    padding: 0,
  },
  mdUl: {
    margin: '0.3em 0',
    paddingLeft: '1.4em',
  },
  mdOl: {
    margin: '0.3em 0',
    // The message font is the (typically monospace) VS Code editor font, whose
    // digits are wider than a proportional font's — 1.4em clips the "1" down
    // to just its trailing dot. 2.4em leaves room for two-digit markers too.
    paddingLeft: '2.4em',
  },
  mdLi: {
    margin: '0.15em 0',
  },
  mdTableWrap: {
    overflowX: 'auto' as const,
    margin: '0.5em 0',
  },
  mdTable: {
    borderCollapse: 'collapse' as const,
    borderSpacing: 0,
    width: 'max-content',
    maxWidth: '100%',
  },
  mdTh: {
    border: '1px solid var(--vscode-panel-border, rgba(127,127,127,0.4))',
    padding: '4px 10px',
    textAlign: 'left' as const,
    fontWeight: 600,
    background: 'rgba(127,127,127,0.14)',
  },
  mdTd: {
    border: '1px solid var(--vscode-panel-border, rgba(127,127,127,0.4))',
    padding: '4px 10px',
  },
  mdQuote: {
    borderLeft: '3px solid var(--vscode-textBlockQuote-border, rgba(127,127,127,0.4))',
    margin: '0.5em 0',
    padding: '0.2em 0 0.2em 0.8em',
    color: 'var(--vscode-descriptionForeground)',
  },
  mdHr: {
    border: 'none',
    borderTop: '1px solid var(--vscode-panel-border, rgba(127,127,127,0.3))',
    margin: '0.8em 0',
  },
  mdLink: {
    color: 'var(--vscode-textLink-foreground)',
    textDecoration: 'underline' as const,
  },
  kodoBody: {
    flex: 1,
    minWidth: 0,
  },
  awaitingLine: {
    color: 'var(--vscode-descriptionForeground)',
    fontStyle: 'italic',
    fontSize: '12px',
    marginTop: '6px',
    marginBottom: '4px',
    letterSpacing: '0.02em',
  },
  statusResponse: {
    color: 'var(--vscode-descriptionForeground)',
    fontSize: '11px',
    marginTop: '4px',
    marginBottom: '2px',
    fontStyle: 'italic',
  },
  thinkingBlock: {
    marginTop: '6px',
    marginBottom: '4px',
    fontSize: '12px',
  },
  thinkingSummary: {
    cursor: 'pointer',
    color: 'var(--vscode-descriptionForeground)',
    fontStyle: 'italic',
    userSelect: 'none' as const,
    listStyle: 'none',
  },
  thinkingContent: {
    color: 'var(--vscode-descriptionForeground)',
    fontSize: '11px',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    padding: '4px 0 4px 12px',
    borderLeft: '2px solid var(--vscode-panel-border)',
    marginTop: '4px',
  },
  toolgenName: {
    background: 'var(--vscode-badge-background)',
    color: 'var(--vscode-badge-foreground)',
    borderRadius: '3px',
    padding: '1px 5px',
    fontFamily: 'monospace',
    fontSize: '11px',
    fontWeight: 'bold' as const,
    fontStyle: 'normal' as const,
  },
  toolgenMeta: {
    fontVariantNumeric: 'tabular-nums' as const,
    opacity: 0.8,
    marginTop: '2px',
    fontSize: '11px',
  },
  toolgenDone: {
    color: 'var(--vscode-descriptionForeground)',
    fontSize: '11px',
    fontStyle: 'italic',
    marginTop: '4px',
    marginBottom: '2px',
  },
  toolCall: {
    fontSize: '12px',
    marginTop: '4px',
    marginBottom: '2px',
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: '4px',
    alignItems: 'baseline',
  },
  toolCallName: {
    background: 'var(--vscode-badge-background)',
    color: 'var(--vscode-badge-foreground)',
    borderRadius: '3px',
    padding: '1px 5px',
    fontFamily: 'monospace',
    fontSize: '11px',
    fontWeight: 'bold',
    flexShrink: 0,
  },
  toolCallOk: {
    color: 'var(--vscode-charts-green, var(--vscode-testing-iconPassed, #3fb950))',
    fontWeight: 'bold' as const,
  },
  toolCallFail: {
    color: 'var(--vscode-charts-red, var(--vscode-testing-iconFailed, #f85149))',
    fontWeight: 'bold' as const,
  },
  toolCallDesc: {
    color: 'var(--vscode-descriptionForeground)',
    fontSize: '11px',
  },
  runCommandProgress: {
    fontSize: '11px',
    fontFamily: 'monospace',
    color: 'var(--vscode-descriptionForeground)',
    marginLeft: '4px',
    marginTop: '2px',
    marginBottom: '4px',
    whiteSpace: 'pre' as const,
  },
  runCommandBar: {
    color: 'var(--vscode-charts-blue, var(--vscode-textLink-foreground))',
  },
  webSearchNote: {
    padding: '1px 0',
  },
  webSearchReport: {
    marginTop: '8px',
    paddingTop: '6px',
    borderTop: '1px solid var(--vscode-panel-border)',
  },
  webSearchReportHeading: {
    fontWeight: 'bold' as const,
    marginBottom: '4px',
  },
  webSearchReportRow: {
    marginBottom: '4px',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
  },
  toolCallBox: {
    border: '1px solid var(--vscode-widget-border, rgba(128,128,128,0.25))',
    borderRadius: '6px',
    padding: '4px 8px',
    marginTop: '3px',
    marginBottom: '4px',
    marginLeft: '4px',
    background: 'var(--vscode-editorWidget-background, var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.08)))',
  },
  toolCallBoxClickable: {
    cursor: 'pointer',
  },
  diffLinkBox: {
    color: 'var(--vscode-textLink-foreground)',
    fontSize: '12px',
  },
  // Right-docked group holding the "open this file" / "undo this change" links
  // on a tool call's header row. `marginLeft: auto` absorbs the row's slack so
  // the whole group (and only the group) pins to the right edge, regardless of
  // which of the two links are actually present.
  toolCallActions: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    marginLeft: 'auto',
    flexShrink: 0,
  },
  openFileLink: {
    color: 'var(--vscode-textLink-foreground)',
    fontSize: '11px',
    cursor: 'pointer',
    flexShrink: 0,
    marginRight: '16px',
  },
  undoChangeLink: {
    color: 'var(--vscode-textLink-foreground)',
    fontSize: '11px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  // Right-aligned row hosting the "Rollback / Roll forward to this state" link
  // beneath a tool call's detail box — docked to the right edge like the
  // undo/redo link above it, rather than the old full-width box.
  rollbackRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    marginTop: '3px',
    marginBottom: '4px',
    marginLeft: '4px',
  },
  rollbackLink: {
    display: 'flex',
    alignItems: 'center',
    color: 'var(--vscode-textLink-foreground)',
    fontSize: '11px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  rollbackIcon: {
    fontSize: '14px',
    marginRight: '4px',
  },
  rollforwardIcon: {
    fontSize: '14px',
    marginRight: '4px',
    display: 'inline-block' as const,
    transform: 'scaleX(-1)',
  },
  toolCallWarn: {
    color: 'var(--vscode-editorWarning-foreground, #cca700)',
    fontSize: '11px',
    marginBottom: '4px',
  },
  toolCallTable: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '11px',
  },
  toolCallParamName: {
    verticalAlign: 'top' as const,
    fontFamily: 'monospace',
    fontWeight: 'bold' as const,
    color: 'var(--vscode-descriptionForeground)',
    padding: '1px 8px 1px 0',
    whiteSpace: 'nowrap' as const,
    width: '1%',
  },
  toolCallParamValue: {
    verticalAlign: 'top' as const,
    fontFamily: 'monospace',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    padding: '1px 0',
  },
  // Sub-agent takeover dividers
  // Sub-agent task brief — the structured task handed to a spawned sub-agent.
  // Left-aligned card, deliberately distinct from the user's prompt bubble.
  subagentTask: {
    alignSelf: 'flex-start' as const,
    maxWidth: '85%',
    margin: '2px 0 8px',
    padding: '6px 10px',
    borderLeft: '3px solid var(--vscode-panel-border)',
    background: 'var(--vscode-textBlockQuote-background)',
    borderRadius: '4px',
  },
  subagentTaskLabel: {
    fontSize: '10px',
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
    color: 'var(--vscode-descriptionForeground)',
    marginBottom: '4px',
  },
  subagentTaskText: {
    // Markdown owns the layout now; no pre-wrap so block spacing isn't doubled.
    fontSize: '12px',
    color: 'var(--vscode-foreground)',
  },
  // Collapsible subsession transcript (SubsessionGroupView) — the clickable
  // title line deliberately reads as a section heading (big + bold), never as
  // just another status line, since it is the only affordance for expanding/
  // collapsing everything the delegated sub-agent did.
  subsessionBlockTitle: {
    fontSize: '14px',
    fontWeight: 700,
    cursor: 'pointer',
    margin: '6px 0 4px',
    padding: '4px 0',
    userSelect: 'none' as const,
  },
  subsessionBlockContent: {
    borderLeft: '3px solid var(--vscode-panel-border)',
    paddingLeft: '10px',
    margin: '0 0 4px',
  },
  // A just-granted "always allow" security rule notice (WS_PROTOCOL.md §5.9d)
  // — the header row mirrors a tool call's (icon + label), and its details
  // sit in the same boxed/monospace table (toolCallBox/toolCallTable) a tool
  // call uses for its parameters, just with an info icon instead of a
  // success/failure one and only the two rows that matter (command, scope).
  securityRuleAdded: {
    fontSize: '12px',
    marginTop: '4px',
    marginBottom: '2px',
    display: 'flex',
    gap: '4px',
    alignItems: 'baseline',
  },
  securityRuleAddedIcon: {
    flexShrink: 0,
  },
  // Outstanding findings offered at the approval gate for individual
  // resolution. Sits between the file list and the actions, because it is part
  // of composing the response rather than a record of it.
  gateFindings: {
    borderTop: '1px solid var(--vscode-panel-border)',
    padding: '6px 0 2px',
    marginTop: '4px',
    fontSize: '12px',
  },
  gateFindingRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
    padding: '2px 0',
    cursor: 'pointer',
  },
  gateFindingDone: {
    textDecoration: 'line-through',
    opacity: 0.6,
  },
  gateFindingWhere: {
    color: 'var(--vscode-descriptionForeground)',
    fontFamily: 'monospace',
    fontSize: '11px',
  },
  // Review findings table (kodo doc/GUIDED_DEV_MODE.md) — the user-only view
  // of a work product's backlog after one review round. Deliberately shaped
  // like the tool-call box rather than a gate card: it is a record of what
  // happened, not something waiting on the user, and a gate card's focus
  // border would say otherwise.
  reviewFindings: {
    border: '1px solid var(--vscode-widget-border, rgba(128,128,128,0.25))',
    borderRadius: '6px',
    marginTop: '4px',
    marginBottom: '8px',
    marginLeft: '4px',
    background:
      'var(--vscode-editorWidget-background, var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.08)))',
  },
  reviewFindingsHeader: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    padding: '6px 8px',
    fontSize: '12px',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  reviewFindingsTitle: {
    fontWeight: 700,
  },
  // The iteration counter and the outstanding/fixed split — the two things
  // that make the table readable as progress rather than a snapshot.
  reviewFindingsCounter: {
    color: 'var(--vscode-descriptionForeground)',
    fontSize: '11px',
    marginLeft: 'auto',
    whiteSpace: 'nowrap' as const,
  },
  reviewFindingsBody: {
    // Wide rows scroll inside the table; the page body never scrolls sideways.
    overflowX: 'auto' as const,
    padding: '0 8px 6px',
  },
  reviewFindingsTable: {
    width: '100%',
    borderCollapse: 'collapse' as const,
    fontSize: '11px',
  },
  reviewFindingsHeadCell: {
    textAlign: 'left' as const,
    color: 'var(--vscode-descriptionForeground)',
    fontWeight: 600,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    padding: '2px 8px 4px 0',
    borderBottom: '1px solid var(--vscode-panel-border)',
    whiteSpace: 'nowrap' as const,
  },
  reviewFindingsCell: {
    verticalAlign: 'top' as const,
    padding: '3px 8px 3px 0',
    borderBottom: '1px solid var(--vscode-panel-border)',
  },
  // A fixed row is history, not work: dimmed and struck so the outstanding
  // rows above it read as the list to act on.
  reviewFindingsRowFixed: {
    opacity: 0.55,
  },
  reviewFindingsLocation: {
    fontFamily: 'monospace',
    whiteSpace: 'nowrap' as const,
  },
  reviewFindingsExtraLocation: {
    fontFamily: 'monospace',
    color: 'var(--vscode-descriptionForeground)',
    whiteSpace: 'nowrap' as const,
    display: 'block',
  },
  reviewFindingsBadge: {
    background: 'var(--vscode-badge-background)',
    color: 'var(--vscode-badge-foreground)',
    borderRadius: '3px',
    padding: '1px 4px',
    fontSize: '10px',
    whiteSpace: 'nowrap' as const,
  },
  reviewFindingsReporter: {
    color: 'var(--vscode-descriptionForeground)',
    whiteSpace: 'nowrap' as const,
  },
  // The session's work-plan widget (kodo doc/PLANNING.md). Deliberately the same
  // card shell as the findings table above — both are "here is the state of
  // something the agent is working through", and two different frames for that
  // would read as two unrelated mechanisms.
  plan: {
    border: '1px solid var(--vscode-widget-border, rgba(128,128,128,0.25))',
    borderRadius: '6px',
    marginTop: '4px',
    marginBottom: '8px',
    marginLeft: '4px',
    background:
      'var(--vscode-editorWidget-background, var(--vscode-editor-inactiveSelectionBackground, rgba(128,128,128,0.08)))',
  },
  planHeader: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '8px',
    padding: '6px 8px',
    fontSize: '12px',
    cursor: 'pointer',
  },
  planTitle: {
    fontWeight: 700,
  },
  // "2 of 4 done" — the counter is what makes the widget readable at a glance
  // when it is collapsed.
  planCounter: {
    color: 'var(--vscode-descriptionForeground)',
    fontSize: '11px',
    marginLeft: 'auto',
    whiteSpace: 'nowrap' as const,
  },
  planBody: {
    padding: '0 8px 6px',
  },
  // A shortfall between what the planner reported and what the engine could use.
  // Warning-coloured because it means the plan may not cover the work.
  planIssue: {
    color: 'var(--vscode-editorWarning-foreground, #cca700)',
    fontSize: '11px',
    paddingBottom: '4px',
  },
  // Why a plan was closed unfinished. Reads as a note, not a failure — the plan
  // was dropped deliberately, and the task rows below still say how far it got.
  planAbandonReason: {
    color: 'var(--vscode-descriptionForeground)',
    fontSize: '11px',
    fontStyle: 'italic' as const,
    paddingBottom: '4px',
  },
  planTaskList: {
    listStyle: 'none' as const,
    margin: 0,
    padding: 0,
    fontSize: '12px',
  },
  planTaskRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '6px',
    padding: '2px 0',
  },
  // Fixed-width so every title starts at the same column regardless of status —
  // a ragged left edge makes an ordered list much harder to scan.
  planTaskMarker: {
    flex: '0 0 auto',
    width: '1.2em',
    textAlign: 'center' as const,
  },
  planTaskIndex: {
    flex: '0 0 auto',
    color: 'var(--vscode-descriptionForeground)',
    fontVariantNumeric: 'tabular-nums' as const,
  },
  planTaskTitle: {
    flex: '1 1 auto',
    minWidth: 0,
  },
  // A finished task is a record, not work: dimmed and struck so the live task
  // and what is still ahead of it are what the eye lands on.
  planTaskTitleDone: {
    flex: '1 1 auto',
    minWidth: 0,
    opacity: 0.55,
    textDecoration: 'line-through' as const,
  },
  planTaskTitleCurrent: {
    flex: '1 1 auto',
    minWidth: 0,
    fontWeight: 700,
  },
  // The planner's development context. Collapsed by default and rendered small:
  // it is reference material the user may want once, not part of the progress
  // read, and it can run to several paragraphs.
  planContextToggle: {
    background: 'none',
    border: 'none',
    color: 'var(--vscode-textLink-foreground)',
    cursor: 'pointer',
    fontSize: '11px',
    padding: '4px 0 0',
    textAlign: 'left' as const,
  },
  planContext: {
    color: 'var(--vscode-descriptionForeground)',
    fontSize: '11px',
    marginTop: '2px',
    whiteSpace: 'pre-wrap' as const,
    // A long briefing scrolls inside the card rather than stretching the feed.
    maxHeight: '16em',
    overflowY: 'auto' as const,
  },
  // Any watchdog nudge (doc/STUCK_DETECTION.md §2.5) now renders via the
  // Markdown renderer's <kodo_warn> callout (markdown.tsx) — a yellow
  // warning box with its own styling — rather than a dedicated style here.
  // File events
  fileEvents: {
    borderTop: '1px solid var(--vscode-panel-border)',
    padding: '6px 0',
    marginBottom: '8px',
  },
  fileEventsHeader: {
    fontSize: '11px',
    color: 'var(--vscode-descriptionForeground)',
    marginBottom: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  fileEvent: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    marginBottom: '2px',
  },
  fileEventKind: {
    background: 'var(--vscode-badge-background)',
    color: 'var(--vscode-badge-foreground)',
    borderRadius: '3px',
    padding: '1px 4px',
    fontSize: '10px',
    flexShrink: 0,
  },
  fileEventPath: {
    flex: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'monospace',
  },
  openBtn: {
    background: 'transparent',
    color: 'var(--vscode-textLink-foreground)',
    border: 'none',
    cursor: 'pointer',
    fontSize: '11px',
    padding: '0 4px',
    textDecoration: 'underline',
    flexShrink: 0,
  },
  // Approval gate
  gateCard: {
    border: '1px solid var(--vscode-focusBorder)',
    borderRadius: '4px',
    padding: '10px',
    marginBottom: '8px',
    background: 'var(--vscode-editor-background)',
  },
  gateHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '6px',
  },
  gateType: {
    background: 'var(--vscode-badge-background)',
    color: 'var(--vscode-badge-foreground)',
    borderRadius: '3px',
    padding: '1px 5px',
    fontSize: '10px',
    fontWeight: 'bold',
  },
  gateTitle: { fontWeight: 'bold', fontSize: '13px' },
  gateSummary: {
    fontSize: '12px',
    color: 'var(--vscode-descriptionForeground)',
    marginBottom: '8px',
    fontStyle: 'italic',
  },
  gateArtifact: { marginBottom: '8px' },
  // A work product's member files, listed on the acceptance gate. The whole set
  // is accepted or rejected in one decision; the per-row toggle only chooses
  // which file a *rejection*'s feedback is anchored to.
  gateFilesHint: {
    fontSize: '11px',
    color: 'var(--vscode-descriptionForeground)',
    marginBottom: '4px',
  },
  gateFileRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    justifyContent: 'space-between',
  },
  gateFileSelect: {
    background: 'transparent',
    color: 'var(--vscode-descriptionForeground)',
    border: 'none',
    cursor: 'pointer',
    fontSize: '10px',
    padding: '0 4px',
    flexShrink: 0,
  },
  gateFileSelected: {
    background: 'transparent',
    color: 'var(--vscode-textLink-foreground)',
    border: 'none',
    cursor: 'pointer',
    fontSize: '10px',
    padding: '0 4px',
    fontWeight: 'bold',
    flexShrink: 0,
  },
  gateActions: { display: 'flex', flexDirection: 'column', gap: '6px' },
  gateTopRow: { display: 'flex', gap: '8px', alignItems: 'center' },
  agreeBtn: {
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    borderRadius: '2px',
    padding: '6px 16px',
    cursor: 'pointer',
    fontWeight: 'bold',
    alignSelf: 'flex-start',
  },
  stopBtn: {
    background: 'transparent',
    color: 'var(--vscode-errorForeground)',
    border: '1px solid var(--vscode-errorForeground)',
    borderRadius: '2px',
    padding: '6px 12px',
    cursor: 'pointer',
    fontWeight: 'bold',
    alignSelf: 'flex-start',
  },
  feedbackRow: { display: 'flex', gap: '6px', alignItems: 'flex-end' },
  feedbackInput: {
    flex: 1,
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border)',
    borderRadius: '2px',
    padding: '4px 6px',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    resize: 'none',
  },
  feedbackBtn: {
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    borderRadius: '2px',
    padding: '6px 16px',
    cursor: 'pointer',
    fontSize: '12px',
    alignSelf: 'stretch',
  },
  // Security permission prompt (replaces the prompt input while pending)
  permissionCard: {
    border: '1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-focusBorder))',
    borderRadius: '4px',
    padding: '10px',
    marginBottom: '8px',
    background: 'var(--vscode-editor-background)',
  },
  permissionRiskBadge: {
    marginLeft: 'auto',
    background: 'var(--vscode-inputValidation-warningBackground, var(--vscode-badge-background))',
    color: 'var(--vscode-foreground)',
    border: '1px solid var(--vscode-inputValidation-warningBorder, transparent)',
    borderRadius: '3px',
    padding: '1px 6px',
    fontSize: '10px',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
  },
  permissionRecoveredBanner: {
    fontSize: '12px',
    lineHeight: '1.4',
    background: 'var(--vscode-inputValidation-warningBackground)',
    color: 'var(--vscode-inputValidation-warningForeground, var(--vscode-foreground))',
    border: '1px solid var(--vscode-inputValidation-warningBorder, transparent)',
    borderRadius: '3px',
    padding: '6px 8px',
    marginBottom: '8px',
  },
  permissionReason: {
    fontSize: '12px',
    marginBottom: '8px',
  },
  permissionIntent: {
    fontSize: '12px',
    color: 'var(--vscode-descriptionForeground)',
    fontStyle: 'italic',
    marginBottom: '8px',
  },
  permissionIntentLabel: {
    fontStyle: 'normal',
    fontWeight: 'bold',
  },
  permissionParams: {
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: '3px',
    padding: '6px 8px',
    marginBottom: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    maxHeight: '140px',
    overflowY: 'auto',
  },
  permissionParamRow: {
    display: 'flex',
    gap: '8px',
    fontSize: '11px',
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
  },
  permissionParamName: {
    color: 'var(--vscode-descriptionForeground)',
    flexShrink: 0,
    minWidth: '80px',
  },
  permissionParamValue: {
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
  },
  // "Always allow <shape>" rule-offer checkboxes (doc/SECURITY_RULES_PLAN.md §2.3)
  permissionRuleOffer: {
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: '3px',
    padding: '6px 8px',
    marginBottom: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  permissionRuleOfferLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    fontSize: '12px',
    cursor: 'pointer',
  },
  permissionRuleOfferShape: {
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    fontWeight: 'bold',
  },
  // Per-part breakdown for a compound command (doc/SECURITY_RULES_PLAN.md §2.6)
  // — only rendered when the ask carries more than one part.
  permissionParts: {
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    marginBottom: '8px',
  },
  permissionPartBlock: {
    borderLeft: '2px solid var(--vscode-panel-border)',
    paddingLeft: '8px',
  },
  permissionPartReason: {
    fontSize: '12px',
    marginBottom: '4px',
  },
  // Stuck-agent watchdog alarm (doc/STUCK_DETECTION.md) — modeled on the
  // permission card's layout, but info-blue rather than warning-amber (this
  // is a behavioral observation, not a security risk) and with no rule
  // checkboxes: there is nothing here to "always allow".
  stuckAlertCard: {
    border: '1px solid var(--vscode-inputValidation-infoBorder, var(--vscode-focusBorder))',
    borderRadius: '4px',
    padding: '10px',
    marginBottom: '8px',
    background: 'var(--vscode-editor-background)',
  },
  stuckAlertReasons: {
    fontSize: '12px',
    lineHeight: '1.5',
    marginBottom: '8px',
    paddingLeft: '18px',
  },
  stuckAlertBtn: {
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    borderRadius: '2px',
    padding: '6px 16px',
    cursor: 'pointer',
    fontWeight: 'bold',
    alignSelf: 'flex-start',
  },
  stuckAlertDismissBtn: {
    background: 'var(--vscode-button-secondaryBackground, transparent)',
    color: 'var(--vscode-button-secondaryForeground, var(--vscode-foreground))',
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: '2px',
    padding: '6px 12px',
    cursor: 'pointer',
    alignSelf: 'flex-start',
  },
  // Edit Control review gate (create_file/edit_file, WS_PROTOCOL.md §6.5b) —
  // modeled on the permission card's layout. The gated call's read-only
  // content/diff opens in a companion editor tab (session-controller.ts); this
  // panel only ever holds the decision controls + feedback list.
  fileReviewCard: {
    border: '1px solid var(--vscode-inputValidation-warningBorder, var(--vscode-focusBorder))',
    borderRadius: '4px',
    padding: '10px',
    marginBottom: '8px',
    background: 'var(--vscode-editor-background)',
  },
  fileReviewModeBadge: {
    marginLeft: 'auto',
    background: 'var(--vscode-badge-background)',
    color: 'var(--vscode-badge-foreground)',
    borderRadius: '3px',
    padding: '1px 6px',
    fontSize: '10px',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
  },
  fileReviewPath: {
    fontSize: '12px',
    fontFamily: 'var(--vscode-editor-font-family, monospace)',
    marginBottom: '8px',
    wordBreak: 'break-all',
  },
  // Permanent "how to add feedback" instructions — always visible, not a
  // hover-only tooltip, since the selection-driven flow isn't discoverable
  // on its own.
  fileReviewInstructions: {
    fontSize: '12px',
    color: 'var(--vscode-descriptionForeground)',
    marginBottom: '8px',
    lineHeight: '1.4',
  },
  fileReviewFeedbackList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
    marginBottom: '8px',
    maxHeight: '220px',
    overflowY: 'auto',
  },
  // One "yellow chip" per feedback note — same gold-outline, transparent-fill
  // look as an attached-file chip. Clicking it (outside the trash icon)
  // re-opens the composer modal to edit it.
  fileReviewFeedbackChip: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    boxSizing: 'border-box' as const,
    padding: '4px 8px',
    border: '1px solid #c8a400',
    borderRadius: '6px',
    background: 'transparent',
    fontSize: '11px',
    cursor: 'pointer',
  },
  fileReviewFeedbackChipMeta: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  fileReviewFeedbackChipLines: {
    fontWeight: 'bold' as const,
  },
  fileReviewFeedbackChipRemove: {
    flexShrink: 0,
    background: 'transparent',
    color: 'inherit',
    border: 'none',
    cursor: 'pointer',
    fontSize: '12px',
    lineHeight: 1,
    padding: 0,
    opacity: 0.85,
  },
  fileReviewActionRow: {
    display: 'flex',
    gap: '8px',
    alignItems: 'center',
  },
  // Modal dialogs (feedback composer + remove confirmation) — a centered box
  // over a dimmed full-panel backdrop. No existing modal precedent elsewhere
  // in the WebView, so styled fresh from VS Code theme vars to match the
  // rest of the UI.
  modalOverlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2000,
  },
  modalBox: {
    width: 'min(512px, 94vw)',
    boxSizing: 'border-box' as const,
    background: 'var(--vscode-editorWidget-background, var(--vscode-editor-background))',
    color: 'var(--vscode-editorWidget-foreground, var(--vscode-foreground))',
    border: '1px solid var(--vscode-widget-border, var(--vscode-focusBorder))',
    borderRadius: '6px',
    padding: '16px',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
  },
  modalTitle: {
    fontWeight: 'bold' as const,
    fontSize: '13px',
    marginBottom: '8px',
    wordBreak: 'break-word' as const,
  },
  modalInstructions: {
    fontSize: '12px',
    color: 'var(--vscode-descriptionForeground)',
    marginBottom: '8px',
  },
  modalTextarea: {
    width: '100%',
    height: '160px',
    boxSizing: 'border-box' as const,
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border)',
    borderRadius: '2px',
    padding: '6px 8px',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    resize: 'none' as const,
    overflow: 'auto' as const,
  },
  modalButtonRow: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '8px',
    marginTop: '10px',
  },
  modalApplyBtnDisabled: {
    opacity: 0.5,
    cursor: 'default' as const,
  },
  modalCancelBtn: {
    background: 'transparent',
    color: 'var(--vscode-foreground)',
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: '2px',
    padding: '6px 16px',
    cursor: 'pointer',
    fontWeight: 'bold' as const,
  },
  modalConfirmMessage: {
    fontSize: '12px',
    marginBottom: '4px',
  },
  // Sampling modal (kodo/doc/SAMPLING.md). Wider than the shared `modalBox`
  // and internally scrollable — it carries ~27 fields across two sections,
  // far more than the feedback composer that box was sized for.
  samplingModalBox: {
    width: 'min(640px, 96vw)',
    maxHeight: '86vh',
    boxSizing: 'border-box' as const,
    display: 'flex',
    flexDirection: 'column' as const,
    background: 'var(--vscode-editorWidget-background, var(--vscode-editor-background))',
    color: 'var(--vscode-editorWidget-foreground, var(--vscode-foreground))',
    border: '1px solid var(--vscode-widget-border, var(--vscode-focusBorder))',
    borderRadius: '6px',
    padding: '16px',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
  },
  samplingModalBody: {
    flex: 1,
    overflowY: 'auto' as const,
    minHeight: 0,
    paddingRight: '4px',
  },
  samplingSectionHeader: {
    fontWeight: 'bold' as const,
    fontSize: '12px',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.04em',
    color: 'var(--vscode-descriptionForeground)',
    margin: '12px 0 6px',
    borderBottom: '1px solid var(--vscode-panel-border)',
    paddingBottom: '4px',
  },
  samplingAdvancedToggle: {
    background: 'transparent',
    color: 'var(--vscode-textLink-foreground)',
    border: 'none',
    padding: '8px 0 4px',
    cursor: 'pointer',
    fontSize: '12px',
    fontWeight: 'bold' as const,
    textAlign: 'left' as const,
  },
  samplingField: {
    marginBottom: '10px',
  },
  samplingFieldRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  samplingLabel: {
    flex: '0 0 60%',
    fontSize: '12px',
    minWidth: '320px',
    wordBreak: 'break-word' as const,
  },
  samplingInput: {
    flex: '0 0 30%',
    marginLeft: 'auto',
    minWidth: '160px',
    boxSizing: 'border-box' as const,
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border)',
    borderRadius: '2px',
    padding: '4px 6px',
    fontFamily: 'inherit',
    fontSize: '12px',
  },
  samplingOrderLabel: {
    flex: '0 0 30%',
    fontSize: '12px',
    minWidth: '160px',
    wordBreak: 'break-word' as const,
  },
  samplingOrderInput: {
    flex: '0 0 60%',
    marginLeft: 'auto',
    minWidth: '320px',
    boxSizing: 'border-box' as const,
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border)',
    borderRadius: '2px',
    padding: '4px 6px',
    fontFamily: 'inherit',
    fontSize: '12px',
  },
  // Shown in the input as placeholder-adjacent text: what happens if the field
  // is left blank. "launch default" when the launch args set one, otherwise
  // "server default", which is the value llama_args launched the server with.
  samplingInheritHint: {
    flex: '0 0 auto',
    fontSize: '11px',
    color: 'var(--vscode-descriptionForeground)',
    whiteSpace: 'nowrap' as const,
  },
  // Full width, deliberately NOT indented under the input column: the help
  // text is a sentence or two per parameter and reads far better across the
  // whole modal than in a 54%-wide gutter. The `samplingDivider` under it is
  // what keeps one parameter's label/input/help visually grouped now that the
  // indent no longer does that job.
  samplingHelp: {
    fontSize: '11px',
    color: 'var(--vscode-descriptionForeground)',
    marginTop: '3px',
  },
  // Closes each parameter's label/input/help group. One after every field,
  // including the last of a section — the rule then doubles as the boundary
  // before the "Advanced" toggle / the end of the scroll body.
  samplingDivider: {
    border: 'none',
    borderTop: '1px solid var(--vscode-panel-border)',
    margin: '8px 0 0',
  },
  // Yellow ⚠ between a parameter's label and its input — either the entered
  // value falls outside the recommended band the server ships for it
  // (`sensible_minimum`/`sensible_maximum`), or it's one the server would
  // silently drop outright (an unknown `samplers` stage name, unparseable
  // number). `samplingFieldIssue` (kodo/doc/SAMPLING.md §8d/§8e) covers both;
  // its `title` says which. Always rendered, one per field — `visibility`
  // toggles, not mount/unmount, so the row's layout never shifts. Disables
  // Apply for the whole modal.
  samplingWarn: {
    flex: '0 0 auto',
    color: 'var(--vscode-editorWarning-foreground, #c8a400)',
    fontSize: '13px',
    cursor: 'help',
  },
  samplingClearBtn: {
    flex: '0 0 auto',
    background: 'transparent',
    color: 'var(--vscode-descriptionForeground)',
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: '2px',
    padding: '3px 7px',
    cursor: 'pointer',
    fontSize: '11px',
  },
  // ask_user question panel (in-feed, interactive until confirmed)
  askUserPanel: {
    border: '1px solid var(--vscode-focusBorder)',
    borderRadius: '4px',
    padding: '10px',
    marginTop: '12px',
    marginBottom: '12px',
    background: 'var(--vscode-editor-background)',
    // scrollIntoView(block:'start') target — keep a little breathing room so
    // the first question does not sit flush against the panel's top edge.
    scrollMarginTop: '8px',
  },
  askUserPanelFrozen: {
    border: '1px solid var(--vscode-panel-border)',
  },
  askUserQuestionBox: {
    border: '1px solid var(--vscode-panel-border)',
    borderRadius: '4px',
    padding: '8px 10px',
    marginBottom: '8px',
  },
  askUserQuestionText: {
    fontSize: '13px',
    fontWeight: 'bold',
    marginBottom: '2px',
  },
  askUserKindHint: {
    fontSize: '10px',
    color: 'var(--vscode-descriptionForeground)',
    marginBottom: '6px',
  },
  askUserOption: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
    padding: '4px 6px',
    borderRadius: '3px',
    cursor: 'pointer',
    userSelect: 'none' as const,
  },
  askUserOptionFrozen: {
    cursor: 'default',
  },
  askUserOptionSelected: {
    background: 'var(--vscode-list-activeSelectionBackground)',
    color: 'var(--vscode-list-activeSelectionForeground)',
  },
  askUserMark: {
    flexShrink: 0,
    width: '16px',
    textAlign: 'center' as const,
  },
  askUserFreeInput: {
    flex: 1,
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    border: '1px solid var(--vscode-input-border)',
    borderRadius: '2px',
    padding: '4px 6px',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    resize: 'none',
  },
  askUserFreeTextFrozen: {
    flex: 1,
    fontStyle: 'italic',
    whiteSpace: 'pre-wrap' as const,
  },
  askUserConfirmBtn: {
    background: 'var(--vscode-button-background)',
    color: 'var(--vscode-button-foreground)',
    border: 'none',
    borderRadius: '2px',
    padding: '8px 16px',
    cursor: 'pointer',
    fontWeight: 'bold',
    width: '100%',
  },
  askUserConfirmBtnDisabled: {
    opacity: 0.55,
    cursor: 'default',
  },
  askUserAnsweredNote: {
    fontSize: '11px',
    color: 'var(--vscode-descriptionForeground)',
    fontStyle: 'italic',
  },
  // Prompt composer — three columns: the fixed-width Session button column
  // (sessionCol), the responsive centre (composerCenter: textarea +
  // attachment row), and the fixed button grid (composerRight). `flex-end`
  // keeps the two fixed columns pinned to the bottom of the WebView while
  // only the textarea in the middle grows upward.
  composerRow: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: '10px',
    paddingTop: '6px',
    // Never squeezed by the transcript above it, however long that grows.
    flexShrink: 0,
  },
  // Centre column. `alignSelf: stretch` makes it match the row's height —
  // which at rest is the 112px both fixed columns now share — so the textarea
  // inside fills that height instead of leaving a gap above itself. (That is
  // 42px shorter than when a five-toggle stack set the row height; the extra
  // room went to the transcript, by explicit choice. Don't reintroduce a
  // minHeight to "restore" the old prompt box.)
  composerCenter: {
    flex: '1 1 auto',
    // The only column that absorbs width changes, in both directions: the two
    // fixed columns never shrink, so this one must be free to (`minWidth: 0`,
    // overriding the textarea's content-based minimum).
    minWidth: 0,
    alignSelf: 'stretch',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  // Right column: its own fixed `0 0 240px` — no longer the same width as
  // `sessionCol` (290px, widened 50px for the Agent/Session Parameters
  // buttons; see that key's comment), since nothing here has a text-fitting
  // problem to solve — holding a 2×3 grid of 56px × 32px cells inset from the
  // centre column by 24px. Each button is explicitly placed (gridColumn/
  // gridRow on its own style) rather than flowed.
  //
  // Column 1 is the send button, spanning every row that reconnect does not
  // need; column 2 stacks attach / stop / delete. There is **no third column**:
  // reconnect, the one conditional button, now shares column 1 with send —
  // taking its bottom row and shortening send from a 3-row span to a 2-row one
  // while the session's workspace is closed. That keeps the grid's footprint
  // identical either way, which is what a reserved-but-empty third column used
  // to buy at the cost of a column's width.
  //
  // Its 3 × 32 + 2 × 8 = 112px height is the whole composer's at-rest height,
  // and `sessionCol` mirrors it (COMPOSER_GRID_HEIGHT) so each left-hand button
  // lands on a grid row. There is no bottom padding: the old
  // `calc((5 * 26px + 4 * 6px) - …)` existed only to stretch this grid to a
  // five-toggle stack that no longer exists.
  //
  // **What is symmetric here is the 24px inset, not the total width.** The grid
  // measures 2 × 56 + 1 × 12 = 124px, well short of the left column's 242px of
  // buttons, and the remaining ~92px is slack at the far right edge of the
  // panel — where there is nothing to align against, so it costs nothing. The
  // inset is what matters: it mirrors the 24px of slack left of the left
  // column's buttons, so the textarea is flanked by two identical 34px gutters
  // (24px + composerRow's 10px gap). **That is the symmetry to preserve** —
  // and it is preserved regardless of `sessionCol`'s own total width, since
  // that gutter is entirely a function of the 24px inset on each side, not of
  // how wide the fixed columns are relative to each other.
  //
  // The buttons were briefly widened (90px cells, three-column 56px before
  // that) to make the grid's total width literally equal the left column's own
  // button width. They looked oversized and were reverted; the options then
  // were to spread them with an 80px column gap or to narrow the whole column
  // and give the space to the textarea, and the user chose neither. So:
  // **don't re-derive the cell width from the left column's button width** —
  // size the cells for the buttons and keep the inset at 24px.
  composerRight: {
    flex: '0 0 240px',
    // border-box so the padding below eats *into* the 240px basis instead of
    // adding to it.
    boxSizing: 'border-box' as const,
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 56px)',
    gridTemplateRows: 'repeat(3, 32px)',
    // row gap, column gap
    gap: '8px 12px',
    justifyContent: 'start' as const,
    // Mirrors the 24px of slack left of the left column's buttons, so the
    // textarea sits between two equal gutters.
    paddingLeft: '24px',
  },
  input: {
    width: '100%',
    background: 'var(--vscode-input-background)',
    color: 'var(--vscode-input-foreground)',
    // Grey when disabled/not-yet-connected (unchanged); overridden to the gold
    // accent below (inputActive) while the box is actually usable, so it reads
    // as the same "yellow rectangle" as the sent-prompt bubble (userPrompt).
    border: '1px solid var(--vscode-input-border)',
    borderRadius: '6px',
    padding: '12px 20px',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    resize: 'none',
    // `flex: 1` lets it fill the centre column at rest (the column is as tall
    // as the toggle stack beside it); the inline height App.tsx's handleInput
    // sets from scrollHeight is the flex basis, so typing past that fill
    // height is what actually grows the composer.
    flex: '1 1 auto',
    minHeight: '56px',
    maxHeight: '250px',
    overflowY: 'auto',
    boxSizing: 'border-box',
  },
  // Merged onto `input` only while it's enabled — matches userPrompt's gold
  // border exactly. Left out of `input` itself so the disabled state keeps
  // its plain grey vscode-input-border, unchanged.
  inputActive: {
    border: '1px solid #c8a400',
  },
  sendBtn: {
    background: 'transparent',
    color: '#2ea043',
    border: '1px solid #2ea043',
    borderRadius: '2px',
    cursor: 'pointer',
    fontSize: '16px',
  },
  // Wraps a footer button's glyph so it (not the button itself) can be nudged
  // on press, giving the four bottom-bar buttons tactile click feedback.
  footerBtnSymbol: {
    display: 'inline-block',
    transform: 'translate(0, 0)',
    transition: 'transform 0.05s ease-out',
  },
  footerBtnSymbolPressed: {
    display: 'inline-block',
    transform: 'translate(1px, 2px)',
    transition: 'transform 0.05s ease-out',
  },
};
