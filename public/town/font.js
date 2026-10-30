// The Crystal font (Font, 128 1bpp glyphs for chars $80-$ff) plus the textbox frame.
// Glyphs are 64-character strings of colour indices: '0' paper, '3' ink.

// The ROM font has no '@', '+' or '#'; these are drawn in its style for email addresses.
export const HAND_GLYPHS = {
  '@': [
    '00000000',
    '00111100',
    '01000010',
    '01011010',
    '01011010',
    '01001110',
    '00100000',
    '00011100',
  ].join('').replace(/1/g, '3'),
  '+': [
    '00000000',
    '00011000',
    '00011000',
    '01111110',
    '01111110',
    '00011000',
    '00011000',
    '00000000',
  ].join('').replace(/1/g, '3'),
  '#': [
    '00000000',
    '00100100',
    '01111110',
    '00100100',
    '00100100',
    '01111110',
    '00100100',
    '00000000',
  ].join('').replace(/1/g, '3'),
};
const BLANK = '0'.repeat(64);

export class Font {
  constructor(font) {
    this.font = font;
  }

  has(ch) {
    return ch === ' ' || ch in this.font.charmap || ch in HAND_GLYPHS;
  }

  glyph(ch) {
    if (ch === ' ') return BLANK;
    const i = this.font.charmap[ch];
    if (i !== undefined) return this.font.glyphs[i];
    return HAND_GLYPHS[ch] || this.font.glyphs[this.font.charmap['?']];
  }

  // Frame tiles in LoadFrame order: ┌ ─ ┐ │ └ ┘
  frame(name) {
    return this.font.frame['┌─┐│└┘'.indexOf(name)];
  }
}
