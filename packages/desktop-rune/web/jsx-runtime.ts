import { createElement as reactCreateElement, Fragment } from "react";
import * as runtime from "react/jsx-runtime";
import type { ComponentType } from "react";
import { Box, Icon, Image, List, Media, Surface, Text, Vector, Webview, Window } from "./dom/elements";
import { Input } from "./dom/input";
import { Markdown } from "./dom/markdown";

/** Rune host element names (host/ELEMENTS.md) → their DOM implementations. */
const HOST: Record<string, ComponentType<any>> = {
  window: Window,
  row: Box("row"),
  col: Box("col"),
  box: Box("box"),
  text: Text,
  input: Input,
  image: Image,
  icon: Icon,
  vector: Vector,
  surface: Surface,
  markdown: Markdown,
  video: Media("video"),
  audio: Media("audio"),
  list: List,
  webview: Webview,
};

const host = (type: unknown) => (typeof type === "string" ? (HOST[type] ?? type) : type);

export { Fragment };
export const jsx = (type: unknown, props: unknown, key?: unknown) => runtime.jsx(host(type) as never, props as never, key as never);
export const jsxs = (type: unknown, props: unknown, key?: unknown) => runtime.jsxs(host(type) as never, props as never, key as never);
export const jsxDEV = (type: unknown, props: unknown, key?: unknown) => runtime.jsx(host(type) as never, props as never, key as never);
export const createElement = (type: unknown, props: unknown, ...children: unknown[]) => reactCreateElement(host(type) as never, props as never, ...(children as never[]));
