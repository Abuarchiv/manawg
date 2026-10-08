import { ImageResponse } from 'next/og';

export const alt = 'ManaWG';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** Preview card for shared invite links (WhatsApp, iMessage, Slack); Neutral 950 with the wordmark. */
export default function OpenGraphImage() {
	return new ImageResponse(
		<div
			style={{
				width: '100%',
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				justifyContent: 'center',
				padding: 96,
				background: '#0a0a0a',
				color: '#ffffff',
			}}
		>
			<div style={{ fontSize: 132, fontWeight: 600, letterSpacing: -4 }}>ManaWG</div>
			<div style={{ marginTop: 24, fontSize: 48, color: '#a3a3a3' }}>
				Ausgaben, Einkauf, Putzen und Pinnwand für deine WG.
			</div>
		</div>,
		size,
	);
}
