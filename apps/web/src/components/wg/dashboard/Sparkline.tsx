interface SparklineProps {
	values: number[];
	height?: number;
	width?: number;
	className?: string;
	color?: string;
	'aria-label'?: string;
}

const STROKE_WIDTH = 1.25;
const PAD_X = 1;
const PAD_Y = 2;

export function Sparkline({
	values,
	height = 40,
	width = 200,
	className = '',
	color = 'var(--chart-1)',
	'aria-label': ariaLabel,
}: SparklineProps) {
	if (values.length === 0) {
		return (
			<svg
				viewBox={`0 0 ${width} ${height}`}
				width={className ? '100%' : width}
				height={height}
				className={className}
				aria-hidden
				preserveAspectRatio="none"
			/>
		);
	}

	const max = Math.max(...values, 1);
	const innerW = width - PAD_X * 2;
	const innerH = height - PAD_Y * 2;
	const step = values.length > 1 ? innerW / (values.length - 1) : 0;

	const points = values.map((v, i) => {
		const x = PAD_X + i * step;
		const y = PAD_Y + innerH - (v / max) * innerH;
		return { x, y };
	});

	const linePath = points
		.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
		.join(' ');

	return (
		<svg
			viewBox={`0 0 ${width} ${height}`}
			width={className ? '100%' : width}
			height={height}
			className={className}
			role={ariaLabel ? 'img' : undefined}
			aria-label={ariaLabel}
			aria-hidden={ariaLabel ? undefined : true}
			preserveAspectRatio="none"
		>
			<path
				d={linePath}
				fill="none"
				stroke={color}
				strokeWidth={STROKE_WIDTH}
				strokeLinecap="round"
				strokeLinejoin="round"
				vectorEffect="non-scaling-stroke"
			/>
		</svg>
	);
}
