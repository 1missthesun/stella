/**
 * Whether the main chat list rests at (or within a few points of) its latest message, as its scroll
 * last reported. The phone reads it when the keyboard starts to rise: a chat at its end rides up
 * with the keyboard, as the React Native app's does, and one scrolled back stays where it is.
 */
export const chatAtEnd = { current: true };

/**
 * The main chat's empty space under its last message: its viewport's height less its content's,
 * points (0 once the messages fill it). The phone reads it with `chatAtEnd` as the keyboard starts
 * to rise: the keyboard first takes that space and only lifts the chat by what is left, so a short
 * chat stays where it is while the composer rises, as the React Native app's does.
 */
export const chatFit = {
  view: 0,
  content: 0,
  get slack() {
    return Math.max(0, this.view - this.content);
  },
};
