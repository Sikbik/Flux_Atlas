import {
  type ChangeEvent,
  type ComponentPropsWithRef,
  type CSSProperties,
  type ReactNode,
  useId,
} from 'react';
import { cx } from '../internal/cx';
import { pressHandlers } from '../internal/press';
import { useControllableState } from '../internal/useControllable';
import { formatSliderValue, fractionOf, normalizeMarks, type SliderMark } from './slider';
import './Slider.css';

export type { SliderMark } from './slider';

export interface SliderProps
  extends Omit<
    ComponentPropsWithRef<'input'>,
    'type' | 'size' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max' | 'step' | 'children'
  > {
  /** The value (controlled). */
  value?: number;
  /** Initial value when uncontrolled. */
  defaultValue?: number;
  /** Called with the new value (a number) as the thumb moves. */
  onChange?: (value: number) => void;
  /** Lowest value (default 0). */
  min?: number;
  /** Highest value (default 100). */
  max?: number;
  /** Increment (default 1). Arrow keys move one step; Home and End jump to the ends. */
  step?: number;
  /** Visible label on the left of the header. Without it, pass `aria-label`. */
  label?: ReactNode;
  /** Formats the readout and the screen-reader value text (`98.5%`, `3.4 TB`). Default: the number, grouped. */
  valueText?: (value: number) => string;
  /** Tick marks under the track: positions, or positions with a mono label. */
  marks?: ReadonlyArray<number | SliderMark>;
  /** Hide the readout (when the value is shown elsewhere). */
  hideValue?: boolean;
}

/**
 * A range slider: a native range input with a filled Flux-blue track, a 16 px thumb, a tabular mono
 * readout and optional tick marks. Keyboard and touch behaviour are the browser's own.
 */
export function Slider({
  value,
  defaultValue,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  valueText,
  marks,
  hideValue,
  className,
  style,
  id,
  disabled,
  ref,
  ...rest
}: SliderProps) {
  const autoId = useId();
  const controlId = id ?? autoId;
  const [current, setCurrent] = useControllableState(value, defaultValue ?? min, onChange);
  const text = (valueText ?? ((v: number) => formatSliderValue(v, step)))(current);
  const ticks = normalizeMarks(marks, min, max);
  const fill = { '--ui-slider-p': fractionOf(current, min, max) } as CSSProperties;

  return (
    <div
      className={cx('ui-slider', className)}
      style={style}
      data-disabled={disabled || undefined}
      {...pressHandlers<HTMLDivElement>()}
    >
      {label !== undefined || !hideValue ? (
        <div className="ui-slider__head">
          {label !== undefined ? (
            <label className="ui-slider__label" htmlFor={controlId}>
              {label}
            </label>
          ) : (
            <span />
          )}
          {hideValue ? null : (
            <span className="ui-slider__value" aria-hidden="true">
              {text}
            </span>
          )}
        </div>
      ) : null}
      <div className="ui-slider__control" style={fill} data-marks={ticks.length > 0 || undefined}>
        <input
          {...rest}
          ref={ref}
          id={controlId}
          type="range"
          className="ui-slider__input"
          min={min}
          max={max}
          step={step}
          value={current}
          disabled={disabled}
          aria-valuetext={text}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrent(Number(e.target.value))}
        />
        {ticks.length > 0 ? (
          <div className="ui-slider__marks" aria-hidden="true">
            {ticks.map((m) => (
              <span
                key={m.value}
                className="ui-slider__mark"
                style={{ '--ui-slider-at': fractionOf(m.value, min, max) } as CSSProperties}
                data-on={m.value <= current || undefined}
              >
                {m.label ? <span className="ui-slider__mark-label">{m.label}</span> : null}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
