'use client';

import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox';
import type { HTMLMotionProps, SVGMotionProps } from 'motion/react';
import * as m from 'motion/react-m';
import { useTranslations } from 'next-intl';
import type * as React from 'react';

import { useControlledState } from '@/core/hooks/use-controlled-state';
import { getStrictContext } from '@/shared/lib/get-strict-context';

import { MotionFeatures } from './motion-features';

type CheckboxContextType = {
	isChecked: boolean;
	setIsChecked: CheckboxProps['onCheckedChange'];
	isIndeterminate: boolean | undefined;
};

const [CheckboxProvider, useCheckbox] = getStrictContext<CheckboxContextType>('CheckboxContext');

type CheckboxProps = Omit<React.ComponentProps<typeof CheckboxPrimitive.Root>, 'render'> &
	HTMLMotionProps<'button'>;

function Checkbox({
	name,
	checked,
	defaultChecked,
	onCheckedChange,
	indeterminate,
	value,
	nativeButton,
	parent,
	disabled,
	readOnly,
	required,
	inputRef,
	id,
	...props
}: CheckboxProps) {
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
		...(indeterminate === undefined ? {} : { indeterminate }),
		...(value === undefined ? {} : { value }),
		// The render target is always a real <button> (m.button), as with the switch:
		// without nativeButton, type="button" is missing (submit in forms) and Base UI warns.
		nativeButton: nativeButton ?? true,
		...(parent === undefined ? {} : { parent }),
		...(disabled === undefined ? {} : { disabled }),
		...(readOnly === undefined ? {} : { readOnly }),
		...(required === undefined ? {} : { required }),
		...(inputRef === undefined ? {} : { inputRef }),
		...(id === undefined ? {} : { id }),
	};

	return (
		<MotionFeatures>
			<CheckboxProvider
				value={{ isChecked: isChecked ?? false, setIsChecked, isIndeterminate: indeterminate }}
			>
				<CheckboxPrimitive.Root
					{...rootProps}
					render={<m.button data-slot="checkbox" {...props} />}
				/>
			</CheckboxProvider>
		</MotionFeatures>
	);
}

type CheckboxIndicatorProps = SVGMotionProps<SVGSVGElement>;

function CheckboxIndicator(props: CheckboxIndicatorProps) {
	const t = useTranslations('shell.ui');
	const { isChecked, isIndeterminate } = useCheckbox();

	return (
		<CheckboxPrimitive.Indicator
			keepMounted
			render={
				<m.svg
					data-slot="checkbox-indicator"
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
					strokeWidth="3.5"
					stroke="currentColor"
					initial="unchecked"
					animate={isChecked ? 'checked' : 'unchecked'}
					{...props}
				>
					<title>
						{isIndeterminate
							? t('checkbox.mixed')
							: isChecked
								? t('checkbox.checked')
								: t('checkbox.unchecked')}
					</title>
					{isIndeterminate ? (
						<m.line
							x1="5"
							y1="12"
							x2="19"
							y2="12"
							strokeLinecap="round"
							initial={{ pathLength: 0, opacity: 0 }}
							animate={{
								pathLength: 1,
								opacity: 1,
								transition: { duration: 0.2 },
							}}
						/>
					) : (
						<m.path
							strokeLinecap="round"
							strokeLinejoin="round"
							d="M4.5 12.75l6 6 9-13.5"
							variants={{
								checked: {
									pathLength: 1,
									opacity: 1,
									transition: {
										duration: 0.2,
										delay: 0.2,
									},
								},
								unchecked: {
									pathLength: 0,
									opacity: 0,
									transition: {
										duration: 0.2,
									},
								},
							}}
						/>
					)}
				</m.svg>
			}
		/>
	);
}

export { Checkbox, CheckboxIndicator, type CheckboxProps };
