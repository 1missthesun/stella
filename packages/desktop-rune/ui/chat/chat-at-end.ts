/**
 * Whether the main chat list rests at (or within a few points of) its latest message, as its scroll
 * last reported. The phone reads it when the keyboard starts to rise: a chat at its end rides up
 * with the keyboard, as the React Native app's does, and one scrolled back stays where it is.
 */
export const chatAtEnd = { current: true };
