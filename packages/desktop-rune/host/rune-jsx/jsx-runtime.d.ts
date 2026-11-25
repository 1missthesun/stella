// Rune's own JSX namespace: only Rune host elements, no DOM. Runtime is React's jsx-runtime.
import type { BoxProps, InputProps, TextProps } from "../app/rune";
export { Fragment, jsx, jsxs } from "react/jsx-runtime";
export namespace JSX {
  type ElementType = React.JSX.ElementType;
  interface Element extends React.JSX.Element {}
  interface ElementClass extends React.JSX.ElementClass {}
  interface ElementAttributesProperty extends React.JSX.ElementAttributesProperty {}
  interface ElementChildrenAttribute extends React.JSX.ElementChildrenAttribute {}
  type LibraryManagedAttributes<C, P> = React.JSX.LibraryManagedAttributes<C, P>;
  interface IntrinsicAttributes extends React.JSX.IntrinsicAttributes {}
  interface IntrinsicClassAttributes<T> extends React.JSX.IntrinsicClassAttributes<T> {}
  interface IntrinsicElements {
    row: BoxProps & { key?: React.Key };
    col: BoxProps & { key?: React.Key };
    box: BoxProps & { key?: React.Key };
    text: TextProps & { key?: React.Key };
    input: InputProps & { key?: React.Key };
  }
}
