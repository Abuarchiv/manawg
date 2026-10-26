import type { CSSProperties } from 'react';

/** Viewport-high chat frame below the app header; the bottom margin cancels the shell's nav padding. */
export const CHAT_FRAME_STYLE: CSSProperties = {
	height:
		'calc(100dvh - env(safe-area-inset-top, 0px) - var(--safe-area-bottom, 0px) - var(--banner-stack-height, 0px) - var(--app-header-height, 0px))',
	marginBottom: 'calc(-1 * (var(--app-nav-height, 5rem) + 0.5rem))',
};
