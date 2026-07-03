/** Natalie Design System — calm motion tokens. */

export const duration = {
  instant: 0,
  fast: 120,
  normal: 200,
  slow: 320,
  slower: 480,
} as const;

export const easing = {
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  enter: "cubic-bezier(0, 0, 0.2, 1)",
  exit: "cubic-bezier(0.4, 0, 1, 1)",
  emphasis: "cubic-bezier(0.2, 0, 0, 1.2)",
} as const;

export const transition = {
  colors: `color ${duration.normal}ms ${easing.standard}, background-color ${duration.normal}ms ${easing.standard}, border-color ${duration.normal}ms ${easing.standard}`,
  transform: `transform ${duration.fast}ms ${easing.standard}`,
  opacity: `opacity ${duration.normal}ms ${easing.standard}`,
  shadow: `box-shadow ${duration.normal}ms ${easing.standard}`,
  all: `all ${duration.normal}ms ${easing.standard}`,
} as const;

/** Tailwind utility recipes */
export const motion = {
  hoverLift: "transition duration-200 hover:-translate-y-0.5",
  press: "transition active:scale-[0.99]",
  appear: "animate-in fade-in duration-200",
  remove: "animate-out fade-out duration-200",
  expand: "transition-[grid-template-rows] duration-320 ease-out",
  collapse: "transition-[grid-template-rows] duration-320 ease-in",
  reduced: "motion-reduce:transition-none motion-reduce:transform-none",
} as const;
