const lib = require('mintd-script/lib');

/* -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
# 设计：
## 支持的规则：
- 随波数变化的单位血量
- 随波数变化的波次间隔
- 自定义武器伤害、装弹速度、血量
- 自定义武器升级树？

## 整体生命周期：
游戏的生命周期为 mod 读取、地图读取、放置所有 block 并 init 所有 entity、WorldLoadEvent

规则应该是游戏开始后进行初始化的，会修改各种配置项；
游戏结束或退出后，应该将各种配置项还原成默认值

## 规则定义方式：
通过信息牌一样的方块，在地图编辑器中进行定义；地图读取时，这些方块主动将配置初始化到全局规则

### 规则格式

## 规则实现：
注意！因为 update 方法每次都要调用，所以务必注意性能。

将内容默认规则全部写好，然后使内容中的生命周期方法全部代理给全局规则代理；
全局规则代理可以决定使用自定义规则还是自定义规则，来完成自定义行为。
eg:
```
// Unit:
function defaultRulesSomeUnit(the) {
    return {
        update(unit) {
            the.super$update(unit);
        },
    };
}
extendContent(GroundUnit, "some-unit", {
    _rule: null,
    load() {
        this.super$load();
        const defaultRules = defaultRulesSomeUnit(this);
        this._rule = GLOBAL_RULES.getUnitRule(this, defaultRules);
    },
    update(unit) {
        this._rule.update(unit);
    }
});
```
-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=- */

const GLOBAL_RULES = (() => {

    const DEBUG = true;

    const log = {
        error(msg) { print("[GR ERROR] " + msg); },
        warn(msg) { print("[GR WARN ] " + msg); },
        info(msg) { print("[GR Info ] " + msg); },
        debug: DEBUG ? msg => print("[GR Debug] " + msg) : () => { },
    };
    function throwErrorAndLog(msg) {
        log.error(msg);
        throw msg;
    }
    /** 第一层解析 */
    function resolveRuleStr(ruleStr) {
        const split = ruleStr.split(": ", 2);
        if (split.length !== 2) {
            const msg = "Rule string [" + ruleStr + "] is invalid!";
            log.error(msg);
            throw msg;
        }
        return {
            ruleStr: ruleStr,
            keys: split[0].split('.'),
            pureRule: split[1].trim()
        };
    }

    /** In-game events */
    const EVENT_REGISTER = (() => {
        const loadListeners = {};
        const waveListeners = {};
        const unloadListeners = {};

        Events.on(EventType.WorldLoadEvent, run(() => {
            // If not, may not we need.
            if (!Vars.state.isEditor() && Vars.world.getMap()) {
                for (var i in loadListeners) {
                    loadListeners[i]();
                }
            }
        }));
        Events.on(EventType.StateChangeEvent, cons(v => {
            if (!Vars.state.isEditor() && v.from == GameState.State.menu && v.to == GameState.State.playing) {
                for (var i in unloadListeners) {
                    unloadListeners[i]();
                }
            }
        }));
        Events.on(EventType.WaveEvent, run(() => {
            if (!Vars.state.isEditor()) {
                const wave = Vars.state.wave;
                for (var i in waveListeners) {
                    waveListeners[i](wave);
                }
            }
        }));

        return {
            addLoadListener(name, func) { loadListeners[name] = func; },
            removeLoadListener(name) { delete loadListeners[name]; },
            addUnloadListener(name, func) { unloadListeners[name] = func; },
            removeUnloadListener(name) { delete unloadListeners[name]; },
            addWaveListener(name, func) { waveListeners[name] = func; },
            removeWaveListener(name) { delete waveListeners[name]; },
        };
    })();

    /**
     * 全局规则，包括波次时间。
     * 波次时间定义示例：
     * global.wave: 0-24:60,25-inf:30
     * [{"s":0,"e":60,"v":60}]
     */
    const GLOBAL_RULE = (() => {
        const RULE_OBJS = [];
        const rules = {};

        // -=-=-=-=-=-=-=-=-=-=-=- Wave rules -=-=-=-=-=-=-=-=-=-=-=-
        var originalWaveSpacing = 60 * 60 * 2;

        function inRange(range, v) {
            var result = v >= range.s && (range.e === null ? true : v <= range.e);
            if (DEBUG) {
                if (result) {
                    log.debug("Value " + v + " in range: " + range.dump());
                } else {
                    log.debug("Value " + v + " not in range: " + range.dump());
                }
            }
            return result;
        }

        function validateWaveRange(rangeList) {
            // i'm lazy
        }

        function resolveSingleRange(rangeStr) {
            log.debug("Resolving single wave rule: " + rangeStr);
            const split1 = rangeStr.split("-");
            if (split1.length !== 2) {
                throwErrorAndLog("Range string " + rangeStr + " is invalid, splitting '-' failed.");
            }
            const split2 = split1[1].split(":");
            if (split1.length !== 2) {
                throwErrorAndLog("Range string " + rangeStr + " is invalid, splitting ':' failed.");
            }
            try {
                function parse(str) {
                    if (str === "inf") { return null; }
                    const num = parseInt(str);
                    if (isNaN(num)) {
                        throwErrorAndLog(str + " is not a invalid number.");
                    }
                    return num;
                }
                const s = parse(split1[0]);
                const e = parse(split2[0]);
                const v = parse(split2[1]);
                return { s: s, e: e, v: v, dump() { return DEBUG ? "{s: " + s + ", e: " + e + ", v: " + v + "}" : ""; } };
            } catch (e) {
                log.error("Resolve range string " + rangeStr + " failed!");
                throw e;
            }
        }

        function resolveWaveRule(ruleStr) {
            log.debug("Resolve wave rule: ["+ruleStr+"]");
            const ranges = ruleStr.split(",");
            if (ranges.length === 0) {
                log.warn("No range rules detected in string [" + ruleStr + "], ignore.");
                return;
            }
            rules.wave = [];
            ranges.forEach(v => rules.wave.push(resolveSingleRange(v)));
            rules.wave.sort((a, b) => a.s - b.s);
            log.debug("Resolved wave rules: " + rules.wave.map(v => v.dump()));
            validateWaveRange(rules.wave);
        }

        function tryModifyWave(nextWave) {
            if (rules.wave) {
                log.debug('Have Wave Rules!');
                var compatibleRange = null;
                for (var i in rules.wave) {
                    var range = rules.wave[i];
                    if (inRange(range, nextWave)) {
                        compatibleRange = range;
                        break;
                    }
                }
                if (compatibleRange !== null) {
                    log.debug('Wave ' + nextWave + ' In range! rangeInfo: ' + range.dump());
                    Vars.state.rules.waveSpacing = range.v * 60;
                    log.debug('Wave ' + nextWave + ' set waveSpacing to: ' + Vars.state.rules.waveSpacing);
                } else {
                    Vars.state.rules.waveSpacing = originalWaveSpacing;
                }
                // Special deal with first wave
                if (nextWave > 1 || Vars.state.wavetime > Vars.state.rules.waveSpacing * 2) {
                    const state = Vars.state;
                    const world = Vars.world;
                    state.wavetime = nextWave == 1
                        ? state.rules.waveSpacing * 2
                        : world.isZone() && world.getZone().isLaunchWave(state.wave)
                            ? state.rules.waveSpacing * state.rules.launchWaveMultiplier
                            : state.rules.waveSpacing;
                }
            }
        }
        EVENT_REGISTER.addLoadListener('global.wave.load', () => {
            originalWaveSpacing = Vars.world.getMap().tag("wavetime");
            log.debug("originalWaveSpacing: " + originalWaveSpacing);
            const nextWave = Vars.state.wave;
            tryModifyWave(nextWave);
        });
        EVENT_REGISTER.addWaveListener('global.wave.wave', (wave) => {
            tryModifyWave(wave);
        });
        // -=-=-=-=-=-=-=-=-=-=-=- ! Wave rules -=-=-=-=-=-=-=-=-=-=-=-

        return {
            STARTS_WITH: "global",
            addRule(ruleObj) {
                RULE_OBJS.push(ruleObj);
                if (ruleObj.keys.length < 2) {
                    throwErrorAndLog("Invalid global rule: " + ruleObj.ruleStr);
                }
                const key = ruleObj.keys[1];
                switch (key) {
                    case "wave":
                        resolveWaveRule(ruleObj.pureRule);
                        break;
                    default:
                        log.warn("Unknown sub global config key [" + key + "], ignore config " + ruleObj.ruleStr);
                }
            }
        };
    })();

    return {
        addRule(ruleStr) {
            const ruleObj = resolveRuleStr(ruleStr);
            const type = ruleObj.keys[0];
            switch (type) {
                case GLOBAL_RULE.STARTS_WITH:
                    GLOBAL_RULE.addRule(ruleObj);
                    break;
                default:
                    log.error("Rule type is unknown, ignore this rule: " + ruleStr);
            }
        },
        getBlockRule(name, blockType, defaultRules) { },
        getUnitRule(name, unitType, defaultRules) { },
    };
})();

(() => {
    const maxTextLength = 10240;
    const maxNewlines = 300;
    const ruleBlockEntityProv = prov(() => {

        var message = "";
        return extend(TileEntity, {
            // No collide to bullets
            collide(other) { return false; },
            collision(other) { },
            getMessage() { return message; },
            setMessage(v) { message = v; },
            write(stream) {
                this.super$write(stream);
                stream.writeUTF(this.message);
            },
            read(stream, revision) {
                this.super$read(stream, revision);
                this.message = stream.readUTF();
                this.message.split("\n").forEach(v => {
                    GLOBAL_RULES.addRule(v);
                });
            },
        });
    });

    const ruleBlock = extendContent(Block, "rule-block", {
        load() {
            this.super$load();
            this.solid = false;
            this.configurable = true;
            this.destructible = false;
            this.targetable = false;
            this.canOverdrive = false;
            this.rebuildable = false;
            this.placeableOn = false;
            this.entityType = ruleBlockEntityProv;
        },
        hasEntity() { return true; },
        setMessageBlockText(tile, text) {
            const entity = tile.ent();
            print('input: ' + text);

            if (entity) {
                const result = text.trim().replace(/\r|\n/g, '\n');
                print('rst: ' + result);

                entity.setMessage(result);
                print(entity.getMessage());
            }
        },

        buildConfiguration(tile, table) {
            const entity = tile.ent();
            table.addImageButton(Icon.pencil, run(() => {
                if (Vars.mobile) {
                    const input = new TextInput();
                    input.text = entity.getMessage();
                    input.multiline = true;
                    input.maxLength = maxTextLength;
                    // TODO compatible with message block
                    input.accepted = cons(msg => this.setMessageBlockText(tile, msg));
                    Core.input.getTextInput(input);
                } else {
                    const dialog = new FloatingDialog("$editmessage");
                    dialog.setFillParent(false);
                    const a = dialog.cont.add(new TextArea(entity.getMessage().replace(/\n/g, "\r"))).size(420, 240).get();
                    a.setFilter(new TextField.TextFieldFilter({
                        acceptChar: (textField, c) => {
                            if (c == '\n' || c == '\r') {
                                var count = 0;
                                for (var i = 0; i < textField.getText().length; i++) {
                                    if (textField.getText().charAt(i) == '\n' || textField.getText().charAt(i) == '\r') {
                                        count++;
                                    }
                                }
                                return count < maxNewlines;
                            }
                            return true;
                        }
                    }));
                    a.setMaxLength(maxTextLength);
                    dialog.buttons.addButton("$ok", run(() => {
                        this.setMessageBlockText(tile, a.getText());
                        dialog.hide();
                    })).size(130, 60);
                    dialog.update(run(() => {
                        if (!entity.isValid()) {
                            dialog.hide();
                        }
                    }));
                    dialog.show();
                }
                Vars.control.input.frag.config.hideConfig();
            })).size(40);
        },
        updateTableAlign(tile, table) {
            var pos = Core.input.mouseScreen(tile.drawx(), tile.drawy() + tile.block().size * Vars.tilesize / 2 + 1);
            table.setPosition(pos.x, pos.y, Align.bottom);
        },

        // invincible
        handleDamage(tile, amount) { return 0; },
        handleBulletHit(entity, bullet) { },
        canBreak(tile) { return Vars.state.isEditor(); },
    });

    Events.on(EventType.WorldLoadEvent, run(() => {
        ruleBlock.configurable = Vars.state.isEditor();
    }));
})();

exports = GLOBAL_RULES;
