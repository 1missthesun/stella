// Rune's own JSX namespace: only Rune host elements, no DOM. Runtime is React's jsx-runtime.
import type { BoxProps, IconProps, VectorProps, SurfaceProps, ImageProps, InputProps, ListProps, MarkdownProps, MediaProps, TextProps, WebviewProps, WindowProps } from "./props";
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
  type K = { key?: React.Key };
  interface IntrinsicElements {
    window: WindowProps & K;
    row: BoxProps & K;
    col: BoxProps & K;
    box: BoxProps & K;
    text: TextProps & K;
    input: InputProps & K;
    image: ImageProps & K;
    icon: IconProps & K;
    vector: VectorProps & K;
    surface: SurfaceProps & K;
    markdown: MarkdownProps & K;
    video: MediaProps & K;
    audio: MediaProps & K;
    list: ListProps & K;
    webview: WebviewProps & K;
  }
}
