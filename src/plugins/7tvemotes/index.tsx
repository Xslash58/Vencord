/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2023 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import "./styles.css";

import { definePluginSettings } from "@api/Settings";
import { classNameFactory } from "@api/Styles";
import { Logger } from "@utils/Logger";
import { Devs } from "@utils/constants";
import { getTheme, insertTextIntoChatInputBox, Theme } from "@utils/discord";
import definePlugin, { OptionType } from "@utils/types";
import { Button, ButtonLooks, ButtonWrapperClasses, Forms, Parser, React, TextInput, Tooltip, useState } from "@webpack/common";
import { Channel, Message } from "discord-types/general";
import { ReactElement, ReactNode } from "react";

const cl = classNameFactory("vc-seventv-");

interface SevenTVEmote {
    name: string;
    animated: boolean;
    host: SevenTVHost;
}
interface SevenTVHost {
    url: string;
}

const emoteRegex = /\/emote\/([a-f0-9]+)\/\w+\.(?:png|webp|gif)/;

let emotes: SevenTVEmote[] = [];
let searching: boolean = false;
let page: number = 1;
let lastApiCall = 0;
let lastError = "";
const MINIMUM_API_DELAY = 500;
const API_URL = "https://7tv.io/v3/gql";
let savedvalue = "";

function GetEmoteURL(emote: SevenTVEmote) {
    const extension = emote.animated ? "gif" : "webp";

    return "https:" + emote.host.url + "/" + settings.store.imagesize + "." + extension;
}

async function FetchEmotes(value, handleRefresh) {
    const currentTime = Date.now();
    const timeSinceLastCall = currentTime - lastApiCall;
    if (timeSinceLastCall < MINIMUM_API_DELAY)
        return;

    lastApiCall = currentTime;

    lastError = "";
    searching = true;
    const query = `query SearchEmotes($query: String!, $page: Int, $sort: Sort, $limit: Int, $filter: EmoteSearchFilter) {
        emotes(query: $query, page: $page, sort: $sort, limit: $limit, filter: $filter) {
          items {
            id
            name
            animated
            host {
              url
            }
          }
        }
      }`;

    if (page < 1) page = 1;

    let variables = {};
    if (value !== "" && value !== undefined)
        variables = {
            "query": value,
            "limit": settings.store.limit,
            "page": page,
            "sort": {
                "value": settings.store.sort_value,
                "order": settings.store.sort_order
            },
            "filter": {
                "category": settings.store.category,
                "exact_match": settings.store.exact_match,
                "case_sensitive": settings.store.case_sensitive,
                "ignore_tags": settings.store.ignore_tags,
                "zero_width": settings.store.zero_width,
                "animated": settings.store.animated,
                "aspect_ratio": ""
            }
        };
    else
        variables = {
            "query": "",
            "limit": settings.store.limit,
            "page": page,
            "sort": {
                "value": settings.store.sort_value,
                "order": settings.store.sort_order
            },
            "filter": {
                "category": settings.store.category
            }
        };

    fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ query, variables })
    }).then(response => response.json())
        .then(data => {
            if (data.data.emotes != null)
                emotes = data.data.emotes.items;
            else
                lastError = data.errors[0].message;
            searching = false;
            handleRefresh();
        })
        .catch(error => { console.error("[7TVEmotes] " + error); searching = false; });
}


const settings = definePluginSettings({
    exact_match: {
        type: OptionType.BOOLEAN,
        description: "Search only for emotes that have EXACTLY the same name as provided",
        default: true,
    },
    case_sensitive: {
        type: OptionType.BOOLEAN,
        description: "Search only for emotes that have the same casing as provided",
        default: false,
    },
    ignore_tags: {
        type: OptionType.BOOLEAN,
        description: "Ignore emote tags",
        default: false,
    },
    zero_width: {
        type: OptionType.BOOLEAN,
        description: "Search for zero-width emotes (You can't overlap emotes on Discord)",
        default: false,
    },
    animated: {
        type: OptionType.BOOLEAN,
        description: "Search ONLY for animated emotes",
        default: false,
    },
    limit: {
        type: OptionType.NUMBER,
        description: "How many emotes per page?",
        default: 42,
    },
    category: {
        type: OptionType.SELECT,
        description: "In which category to search for emotes?",
        options: [
            { label: "TOP", value: "TOP", default: true },
            { label: "TRENDING", value: "TRENDING_DAY" }
        ],
    },
    sort_value: {
        type: OptionType.SELECT,
        description: "Sort by:",
        options: [
            { label: "Popularity", value: "popularity", default: true },
            { label: "Date Created", value: "date_created" }
        ],
    },
    sort_order: {
        type: OptionType.SELECT,
        description: "",
        options: [
            { label: "Descending", value: "DESCENDING", default: true },
            { label: "Ascending", value: "ASCENDING" }
        ],
    },
    imagesize: {
        type: OptionType.SELECT,
        description: "Default image size:",
        options: [
            { label: "1x", value: "1x", default: true },
            { label: "2x", value: "2x" },
            { label: "3x", value: "3x" },
            { label: "4x", value: "4x" }
        ],
    }
});

export default definePlugin({
    name: "7TV Emotes",
    description: "Search for 7TV Emotes in your Discord Client!",
    authors: [Devs.Xslash, Devs.Arjix],

    patches: [
        {
            find: ".Messages.EXPRESSION_PICKER_GIF",
            replacement: [
                {
                    match: /null==\(null===\(\w=\w\.emojis\)\|\|void 0.*?\.consolidateGifsStickersEmojis.*?(\w)\.push\((\(0,\w\.jsx\))\((\w+),{disabled:\w,type:(\w)},"emoji"\)\)/,
                    replace: (m, btnArray, jsx, compo, type) => {
                        const c = "arguments[0].type";
                        return `${m};(${c}?.submit?.button||${c}?.attachments)&&${btnArray}.push(${jsx}(${compo},{disabled:!(${c}?.submit?.button||${c}?.attachments),type:${type},emojiType:"7TV"},"7TV"))`;
                    }
                },
                {
                    match: /(\.Messages\.PREMIUM_TRIAL_TUTORIAL_EMOJI_TOOLTIP.*?;return.*?,\w+\(\)\.buttonContainer.*?children:\(0,\w+\.jsx\)\()(.*?)(,.*?active:((\w).*?),)/,
                    replace: (_, head, comp, tail, emojiActive, activeView) => {
                        const isSevenTv = "arguments[0]?.emojiType===\"7TV\"";
                        const isActive = `(${isSevenTv}&&${activeView}==="7TV")||${emojiActive}`;
                        const rest = tail.replace(emojiActive, isActive);

                        return `${head}(${isSevenTv}?$self.chatBarIcon:${comp})${rest}`;
                    }
                },
                {
                    match: /(var \w=)(\w\.useCallback\(\(function\(\)\{\(0,\w+\.\w+\)\(.*?\.EMOJI,.*?);/,
                    replace: (_, decl, cb) => {
                        const newCb = cb.replace(/(?<=function\(\)\{\(.*?\)\().+?\.EMOJI/, "\"7TV\"");
                        return `${decl}arguments[0]?.emojiType?${newCb}:${cb};`;
                    }
                },
                {
                    match: /role:"tablist",.{10,20}\.Messages\.EXPRESSION_PICKER_CATEGORIES_A11Y_LABEL,children:\[.*?\)\]}\)}\):null,.*?onSelectEmoji:\w.*?:null/s,
                    replace: m => {
                        const stickerTabRegex = /,(\(0,\w\.jsx\))\((\w+?),\{.{50,100}isActive:(\w)===.*?\.EMOJI,\s*?viewType:.*?EXPRESSION_PICKER_EMOJI}\)/;
                        const res = m.replace(stickerTabRegex, (_m, jsx, tabHeaderComp, currentTab, stickerText) => {
                            const isActive = `${currentTab}==="7TV"`;
                            return (
                                `${_m},${jsx}(${tabHeaderComp},{id:"seventv-picker-tab","aria-controls":"seventv-picker-tab-panel","aria-selected":${isActive},isActive:${isActive},autoFocus:true,viewType:"7TV",children:${jsx}("div",{children:"7TV"})})`
                            );
                        });

                        return res.replace(/(\w)===.{1,10}\.EMOJI\?(\(0,\w\.jsx\)).*?(\{.*?\})\):null/, (_, currentTab, jsx, props) => {
                            return `${_},${currentTab}==="7TV"?${jsx}($self.SevenTVComponent,${props}):null`;
                        });
                    }
                }
            ]
        },
        {
            find: '["strong","em","u","text","inlineCode","s","spoiler"]',
            replacement: [
                {
                    predicate: () => true,
                    match: /1!==(\i)\.length\|\|1!==\i\.length/,
                    replace: (m, content) => `${m}||$self.shouldKeepEmoteLink(${content}[0])`
                },
                {
                    predicate: () => true,
                    match: /(?=return{hasSpoilerEmbeds:\i,content:(\i)})/,
                    replace: (_, content) => `${content}=$self.patchFakeNitroEmojisOrRemoveStickersLinks(${content},arguments[2]?.formatInline);`
                }
            ]
        },
        {
            find: "renderEmbeds=function",
            replacement: [
                {
                    predicate: () => true,
                    match: /(renderEmbeds=function\((\i)\){)(.+?embeds\.map\(\(function\((\i)\){)/,
                    replace: (_, rest1, message, rest2, embed) => `${rest1}const fakeNitroMessage=${message};${rest2}if($self.shouldIgnoreEmbed(${embed},fakeNitroMessage))return null;`
                    //replace: (_, rest1, message, rest2, embed) => `${rest1}const fakeNitroMessage=${message};${rest2}if(true)return null;`
                }
            ]
        },
        {
            find: ".Messages.EMOJI_POPOUT_PREMIUM_JOINED_GUILD_DESCRIPTION",
            predicate: () => true,
            replacement: {
                match: /((\i)=\i\.node,\i=\i\.emojiSourceDiscoverableGuild)(.+?return )(.{0,450}Messages\.EMOJI_POPOUT_PREMIUM_JOINED_GUILD_DESCRIPTION.+?}\))/,
                replace: (_, rest1, node, rest2, reactNode) => `${rest1},fakeNitroNode=${node}${rest2}$self.addFakeNotice(${reactNode},fakeNitroNode.fake)`
            }
        }
    ],
    settings,

    clearEmptyArrayItems(array: Array<any>) {
        return array.filter(item => item != null);
    },

    trimContent(content: Array<any>) {
        const firstContent = content[0];
        if (typeof firstContent === "string") content[0] = firstContent.trimStart();
        if (content[0] === "") content.shift();

        const lastIndex = content.length - 1;
        const lastContent = content[lastIndex];
        if (typeof lastContent === "string") content[lastIndex] = lastContent.trimEnd();
        if (content[lastIndex] === "") content.pop();
    },

    shouldKeepEmoteLink(link: any) {
        return link.target && emoteRegex.test(link.target);
    },

    ensureChildrenIsArray(child: ReactElement) {
        if (!Array.isArray(child.props.children)) child.props.children = [child.props.children];
    },

    patchFakeNitroEmojisOrRemoveStickersLinks(content: Array<any>, inline: boolean) {
        // If content has more than one child or it's a single ReactElement like a header or list
        if ((content.length > 1 || typeof content[0]?.type === "string")) return content;

        let nextIndex = content.length;

        const transformLinkChild = (child: ReactElement) => {
            const emoteMatch = child.props.href.match(emoteRegex);
            if (emoteMatch) {
                let url: URL | null = null;
                try {
                    url = new URL(child.props.href);
                } catch { }

                const emojiName = url?.searchParams.get("name") ?? "7TV Emote";

                return Parser.defaultRules.customEmoji.react({
                    jumboable: !inline && content.length === 1 && typeof content[0].type !== "string",
                    animated: emoteMatch[2] === "gif",
                    emojiId: emoteMatch[1],
                    //animated: false,
                    //emojiId: 1055659354931605567,
                    name: emojiName,
                    fake: true
                }, void 0, { key: String(nextIndex++) });
            }

            return child;
        };

        const transformChild = (child: ReactElement) => {
            if (child?.props?.trusted != null) return transformLinkChild(child);
            if (child?.props?.children != null) {
                if (!Array.isArray(child.props.children)) {
                    child.props.children = modifyChild(child.props.children);
                    return child;
                }

                child.props.children = modifyChildren(child.props.children);
                if (child.props.children.length === 0) return null;
                return child;
            }

            return child;
        };

        const modifyChild = (child: ReactElement) => {
            const newChild = transformChild(child);

            if (newChild?.type === "ul" || newChild?.type === "ol") {
                this.ensureChildrenIsArray(newChild);
                if (newChild.props.children.length === 0) return null;

                let listHasAnItem = false;
                for (const [index, child] of newChild.props.children.entries()) {
                    if (child == null) {
                        delete newChild.props.children[index];
                        continue;
                    }

                    this.ensureChildrenIsArray(child);
                    if (child.props.children.length > 0) listHasAnItem = true;
                    else delete newChild.props.children[index];
                }

                if (!listHasAnItem) return null;

                newChild.props.children = this.clearEmptyArrayItems(newChild.props.children);
            }

            return newChild;
        };

        const modifyChildren = (children: Array<ReactElement>) => {
            for (const [index, child] of children.entries()) children[index] = modifyChild(child);

            children = this.clearEmptyArrayItems(children);
            this.trimContent(children);

            return children;
        };

        try {
            return modifyChildren(window._.cloneDeep(content));
        } catch (err) {
            new Logger("7TVEmotes").error(err);
            return content;
        }
    },

    shouldIgnoreEmbed(embed: Message["embeds"][number], message: Message) {
        const contentItems = message.content.split(/\s/);
        if (contentItems.length > 1) return false;

        switch (embed.type) {
            case "image": {
                if (!contentItems.includes(embed.url!) && !contentItems.includes(embed.image!.proxyURL)) return false;

                if (emoteRegex.test(embed.url!)) return true;

                break;
            }
        }

        return false;
    },

    addFakeNotice(node: Array<ReactNode>, fake: boolean) {
        if (!fake) return node;

        node = Array.isArray(node) ? node : [node];

        node.push(" This is a 7TV Emote and renders like a real emoji only for you. Appears as a link to non-plugin users.");
        return node;
    },

    SevenTVComponent({
        channel,
        closePopout
    }: {
        channel: Channel,
        closePopout: () => void;
    }) {
        const [value, setValue] = useState<string>();
        const [count, setCount] = useState(0);

        const handleRefresh = () => {
            setCount(count + 1);
        };

        if ((value === undefined) && (savedvalue !== "undefined" && savedvalue !== ""))
            setValue(savedvalue);
        savedvalue = value + "";

        if (emotes.length === 0)
            FetchEmotes(value, handleRefresh);

        return (
            <div className={cl("picker")}>
                <div className={cl("picker-content")}>
                    <div className="seventv-navigation">
                        <TextInput className="seventv-searchinput"
                            type="string"
                            value={value}
                            onChange={e => setValue(e)}
                            placeholder="Search 7TV Emotes"
                            spellCheck="false"
                            style={{
                                colorScheme: getTheme() === Theme.Light ? "light" : "dark",
                            }}
                            onKeyDown={e => {
                                if (e.key === "Enter")
                                    if (!searching) {
                                        page = 1;
                                        FetchEmotes(value, handleRefresh);
                                    }
                            }}
                        />
                        <div className="seventv-searchbutton" style={{
                            boxSizing: "border-box"
                        }} onClick={() => {
                            if (!searching) {
                                page = 1;
                                FetchEmotes(value, handleRefresh);
                            }
                        }}>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50" width="24px" height="24px">
                                <path fill="#b5bac1" d="M 21 3 C 11.621094 3 4 10.621094 4 20 C 4 29.378906 11.621094 37 21 37 C 24.710938 37 28.140625 35.804688 30.9375 33.78125 L 44.09375 46.90625 L 46.90625 44.09375 L 33.90625 31.0625 C 36.460938 28.085938 38 24.222656 38 20 C 38 10.621094 30.378906 3 21 3 Z M 21 5 C 29.296875 5 36 11.703125 36 20 C 36 28.296875 29.296875 35 21 35 C 12.703125 35 6 28.296875 6 20 C 6 11.703125 12.703125 5 21 5 Z" />
                            </svg>
                        </div>
                    </div>

                    <br></br>

                    <Forms.FormDivider></Forms.FormDivider>

                    <div className="seventv-emotes">
                        {emotes.map(emote => (
                            <Tooltip text={emote.name}>
                                {({ onMouseEnter, onMouseLeave }) => (
                                    <Button className="seventv-emotebutton"
                                        look="BLANK"
                                        size="ICON"
                                        aria-haspopup="dialog"
                                        onMouseEnter={onMouseEnter}
                                        onMouseLeave={onMouseLeave}
                                        datatype="emoji"
                                        onClick={() => {
                                            insertTextIntoChatInputBox(GetEmoteURL(emote));
                                            closePopout();
                                        }}
                                    ><img src={GetEmoteURL(emote)} height="40px"></img></Button>
                                )}
                            </Tooltip>
                        ))}
                    </div>

                    <Forms.FormDivider></Forms.FormDivider>
                    <br></br>

                    <div className="seventv-navigation">
                        <Button className="seventv-pagebutton"
                            look={Button.Looks.BLANK}
                            onClick={() => {
                                if (!searching) {
                                    page--;
                                    FetchEmotes(value, handleRefresh);
                                }
                            }}
                        >
                            <svg fill="#000000" height="24px" width="24px" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 490 490">
                                <g>
                                    <polygon fill="#b5bac1" points="242.227,481.919 314.593,407.95 194.882,290.855 490,290.855 490,183.86 210.504,183.86 314.593,82.051 242.227,8.081 0,244.996" />
                                </g>
                            </svg></Button>
                        <Button className="seventv-pagebutton"
                            look={Button.Looks.BLANK}
                            onClick={() => {
                                if (!searching) {
                                    page++;
                                    FetchEmotes(value, handleRefresh);
                                }
                            }}
                        >
                            <svg fill="#000000" height="24px" width="24px" version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 490 490">
                                <g>
                                    <g>
                                        <polygon fill="#b5bac1" points="247.773,8.081 175.407,82.05 295.118,199.145 0,199.145 0,306.14 279.496,306.14 175.407,407.949 247.773,481.919 490,245.004" />
                                    </g>
                                </g>
                            </svg></Button>
                    </div>
                </div>

                <div className={cl("footer")}>
                    <Forms.FormText className="seventv-pagetext">{lastError === "" ? (<>Page {page}</>) : (<>{lastError}</>)}</Forms.FormText>
                </div>
            </div >
        );
    },

    chatBarIcon({
        onClick,
        active
    }) {
        return (
            <Tooltip text="7TV Emotes">
                {({ onMouseEnter, onMouseLeave }) => (
                    <div style={{ display: "flex" }}>
                        <Button
                            aria-haspopup="dialog"
                            aria-label=""
                            size=""
                            look={ButtonLooks.BLANK}
                            onMouseEnter={onMouseEnter}
                            onMouseLeave={onMouseLeave}
                            innerClassName={ButtonWrapperClasses.button}
                            onClick={onClick}
                            className={cl("button")}
                        >
                            <div className={ButtonWrapperClasses.buttonWrapper}>
                                <svg
                                    aria-hidden="true"
                                    role="img"
                                    width="24"
                                    height="24"
                                    viewBox="0 0 109.6 80.9"
                                    className={cl("chat-icon") + (active ? " active" : "")}
                                >
                                    <g>
                                        <path d="M84.1,22.2l5-8.7,2.7-4.6L86.8.2V0H60.1l5,8.7,5,8.7,2.8,4.8H84.1"></path>
                                        <path d="M29,80.6l5-8.7,5-8.7,5-8.7,5-8.7,5-8.7,5-8.7L62.7,22l-5-8.7-5-8.7L49.9.1H7.7l-5,8.7L0,13.4l5,8.7v.2h32l-5,8.7-5,8.7-5,8.7-5,8.7-5,8.7L8.5,72l5,8.7v.2H29"></path>
                                        <path d="M70.8,80.6H86.1l5-8.7,5-8.7,5-8.7,5-8.7,3.5-6-5-8.7v-.2H89.2l-5,8.7-5,8.7-.7,1.3-5-8.7-5-8.7-.7-1.3-5,8.7-5,8.7L55,53.1l5,8.7,5,8.7,5,8.7.8,1.4"></path>
                                    </g>
                                </svg>
                            </div>
                        </Button>
                    </div>
                )
                }
            </Tooltip >
        );
    },
});
