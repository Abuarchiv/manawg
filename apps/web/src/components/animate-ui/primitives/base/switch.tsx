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
						whileTap="tap"
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
		pressedAnimation?: TargetAndTransition | VariantLabels | boolean | LegacyAnimationControls;
	};

function SwitchThumb({
	pressedAnimation,
	transition = { type: 'spring', stiffness: 300, damping: 25 },
	...props
}: SwitchThumbProps) {
	const { isPressed } = useSwitch();

	return (
		<SwitchPrimitives.Thumb
			render={
				<motion.div
					data-slot="switch-thumb"
					whileTap="tab"
					layout
					transition={transition}
					{...(isPressed && pressedAnimation !== undefined ? { animate: pressedAnimation } : {})}
					{...props}
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
	transition = { type: 'spring', bounce: 0 },
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
