declare module 'twemoji-parser' {
    export interface EmojiEntity {
        url: string;
        indices: [number, number];
        text: string;
        type: string;
    }

    export function parse(text: string, options?: {
        buildUrl?: (codepoints: string, assetType: string) => string;
        assetType?: 'png' | 'svg';
    }): EmojiEntity[];
}
