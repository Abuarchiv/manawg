'use client';

import { Switch as SwitchPrimitives } from '@base-ui-components/react/switch';
import {
	type HTMLMotionProps,
	type LegacyAnimationControls,
	type TargetAndTransition,
	type VariantLabels,
	motion,
} from 'motion/react';
import * as React from 'react';

import { useControlledState } from '@/hooks/use-controlled-state';
import { getStrictContext } from '@/lib/get-strict-context';

type SwitchContextType = {
	isChecked: boolean;
	setIsChecked: SwitchProps['onCheckedChange'];
	isPressed: boolean;
	setIsPressed: (isPressed: boolean) => void;
};

const [SwitchProvider, useSwitch] = getStrictContext<SwitchContextType>('SwitchContext');

type SwitchProps = Omit<React.ComponentProps<typeof SwitchPrimitives.Root>, 'render'> &
	HTMLMotionProps<'button'>;

function Switch({
	name,
	defaultChecked,
	checked,
	onCheckedChange,
	nativeButton,
	disabled,
	readOnly,
	required,
	inputRef,
	id,
	...props
}: SwitchProps) {
	const [isPressed, setIsPressed] = React.useState(false);
	const [isChecked, setIsChecked] = useControlledState({
		...(checked === undefined ? {} : { value: checked }),
		...(defaultChecked === undefined ? {} : { defaultValue: defaultChecked }),
		...(onCheckedChange === undefined ? {} : { onChange: onCheckedChange }),
	});
	const rootProps = {
		...(name === undefined ? {} : { name }),
		...(defaultChecked === undefined ? {} : { defaultChecked }),
		...(checked === undefined ? {} : { checked }),
		onCheckedChange: setIsChecked,
		...(nativeButton === undefined ? {} : { nativeButton }),
		...(disabled === undefined ? {} : { disabled }),
		...(readOnly === undefined ? {} : { readOnly }),
		...(required === undefined ? {} : { required }),
		...(inputRef === undefined ? {} : { inputRef }),
		...(id === undefined ? {} : { id }),
	};

	return (
		<SwitchProvider value={{ isChecked, setIsChecked, isPressed, setIsPressed }}>
			<SwitchPrimitives.Root
				{...rootProps}
				render={
					<motion.button
						data-slot="switch"
						data-pressed={isPressed ? '' : undefined}
						initial={false}
						onTapStart={() => setIsPressed(true)}
						onTapCancel={() => setIsPressed(false)}
						onTap={() => setIsPressed(false)}
						{...props}
					/>
				}
			/>
		</SwitchProvider>
	);
}

type SwitchThumbProps = Omit<React.ComponentProps<typeof SwitchPrimitives.Thumb>, 'render'> &
	HTMLMotionProps<'div'> & {
		pressedWidth?: number;
		pressedAnimation?: TargetAndTransition | VariantLabels | boolean | LegacyAnimationControls;
	};

function SwitchThumb({
	pressedWidth = 59,
	pressedAnimation: _pressedAnimation,
	transition: _transition,
	...props
}: SwitchThumbProps) {
	const { isChecked, isPressed } = useSwitch();
	const pressedShadow = isChecked
		? 'inset 0.5px 0.5px 0 rgba(0,0,0,0.42), inset -1px -1px 0 var(--primary-foreground), inset -2px 4px 4px rgba(0,0,0,0.08), inset -1px 1.5px 0.5px var(--primary), inset -1.5px -2px 0.5px var(--primary), inset -1.75px -2.75px 1px color-mix(in oklch, var(--primary), var(--foreground) 35%), 0.5px 0.5px 2px rgba(0,0,0,0.03), 0 2px 32px rgba(10,10,10,0.2)'
		: 'inset 0.5px 0.5px 0 rgba(0,0,0,0.18), inset -1px -1px 0 var(--primary-foreground), inset -2px 4px 4px rgba(0,0,0,0.08), inset -1px 1.5px 0.5px var(--input), inset -1.5px -2px 0.5px var(--input), inset -1.75px -2.75px 1px color-mix(in oklch, var(--input), var(--foreground) 5%), 0.5px 0.5px 2px rgba(0,0,0,0.03), 0 2px 32px rgba(10,10,10,0.1)';
	const thumbStyle = {
		...props.style,
		left: isPressed ? (isChecked ? 17 : -8) : isChecked ? 27.5 : 2.5,
		top: isPressed ? 2.5 : 9.5,
		width: isPressed ? pressedWidth : 38,
		height: isPressed ? 39 : 25,
		boxShadow: isPressed ? pressedShadow : '0.5px 0.5px 2px rgba(0,0,0,0.03)',
	};

	return (
		<SwitchPrimitives.Thumb
			render={
				<motion.div
					data-slot="switch-thumb"
					data-pressed={isPressed ? '' : undefined}
					{...props}
					style={thumbStyle}
				/>
			}
		/>
	);
}

type SwitchIconPosition = 'left' | 'right' | 'thumb';

type SwitchIconProps = HTMLMotionProps<'div'> & {
	position: SwitchIconPosition;
};

function SwitchIcon({
	position,
	transition = { duration: 0.28, ease: 'easeOut' },
	...props
}: SwitchIconProps) {
	const { isChecked } = useSwitch();

	const isAnimated = React.useMemo(() => {
		if (position === 'right') return !isChecked;
		if (position === 'left') return isChecked;
		if (position === 'thumb') return true;
		return false;
	}, [position, isChecked]);

	return (
		<motion.div
			data-slot={`switch-${position}-icon`}
			animate={isAnimated ? { scale: 1, opacity: 1 } : { scale: 0, opacity: 0 }}
			transition={transition}
			{...props}
		/>
	);
}

export {
	Switch,
	SwitchThumb,
	SwitchIcon,
	useSwitch,
	type SwitchProps,
	type SwitchThumbProps,
	type SwitchIconProps,
	type SwitchIconPosition,
	type SwitchContextType,
};
