declare module 'emoji-mart-vue-fast/src' {
  export const Picker: any;
  export class EmojiIndex {
    constructor(data: any, opts?: any);
    search?(q: string): any[];
    findEmoji?(idOrColons: string): any;
    nativeEmoji?(char: string): any;
  }
}
