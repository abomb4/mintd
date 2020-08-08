
const lib = require('mintd-script/lib');

// 传送器：
// 1. [ ] 被连接一端不能连别人
// 2. [ ] 两个传送器之间的距离必须超过 UNBUILDABLE_RADIUS
// 3. [ ] 接收端与发送端的特效，发送端蓝色，接收端橙色

const ORANGE = Color.valueOf("#fea947");
const BLUE = Color.valueOf("#3ebdfc");

const teleporterEntityProv = prov(() => {
    var target = Pos.invalid;
    var connected = false;
    var uptime = 0;
    var lastColor = BLUE;
    return extend(TileEntity, {
        // No collide to bullets
        collide(other) { return false; },
        collision(other) { },
        isValid() { return false; },

        setTarget(v) { target = v; },
        getTarget() { return target; },
        setUptime(v) { uptime = v; },
        getUptime() { return uptime; },
        setConnected(v) { connected = v; },
        getConnected() { return connected; },
        setLastColor(v) { lastColor = v; },
        getLastColor() { return lastColor; },
        // Save Load
        write(stream) {
            this.super$write(stream);
            stream.writeInt(target);
            stream.writeBoolean(connected);
            stream.writeFloat(uptime);
            stream.writeBoolean(lastColor == BLUE ? true : false);
        },
        read(stream, revision) {
            this.super$read(stream, revision);
            target = stream.readInt();
            connected = stream.readBoolean();
            uptime = stream.readFloat();
            lastColor = stream.readBoolean() ? BLUE : ORANGE;
        },
    });
});

const teleporter = (() => {

    const unitInEffect = newEffect(8, e => {
        const unitSize = e.data.getUnitSize();
        Draw.color(BLUE);
        Draw.alpha(0.5);
        Lines.stroke(e.fout() * 2);
        Lines.circle(e.x, e.y, 2 + e.finpow() * unitSize * 0.5);
    });

    const unitOutEffect = newEffect(8, e => {
        const unitSize = e.data.getUnitSize();
        Draw.color(ORANGE);
        Draw.alpha(0.5);
        Lines.stroke(e.fout() * 2);
        Lines.circle(e.x, e.y, 2 + e.finpow() * unitSize * 0.5);
    });

    const inEffect = newEffect(38, e => {
        Draw.color(BLUE);

        Angles.randLenVectors(e.id, 1, 12 * e.fout(), 0, 360, new Floatc2({
            get: (x, y) => {
                var angle = Angles.angle(0, 0, x, y);
                var trnsx = Angles.trnsx(angle, 2);
                var trnsy = Angles.trnsy(angle, 2);
                var trnsx2 = Angles.trnsx(angle, 4);
                var trnsy2 = Angles.trnsy(angle, 4);
                Fill.circle(
                    e.x + trnsx + x + trnsx2 * e.fout(),
                    e.y + trnsy + y + trnsy2 * e.fout(),
                    e.fslope() * 0.8
                );
            }
        }));
    });

    const outEffect = newEffect(38, e => {
        Draw.color(ORANGE);

        Angles.randLenVectors(e.id, 1, 12 * e.fin(), 0, 360, new Floatc2({
            get: (x, y) => {
                var angle = Angles.angle(0, 0, x, y);
                var trnsx = Angles.trnsx(angle, 2);
                var trnsy = Angles.trnsy(angle, 2);
                var trnsx2 = Angles.trnsx(angle, 4);
                var trnsy2 = Angles.trnsy(angle, 4);
                Fill.circle(
                    e.x + trnsx + x + trnsx2 * e.fin(),
                    e.y + trnsy + y + trnsy2 * e.fin(),
                    e.fslope() * 0.8
                );
            }
        }));
    });

    // 传送生效范围，size单位
    const TELEPORTER_RADIUS = 10;
    // 传送距离，block 单位（x8 = 实际距离）
    const RANGE = 500;
    // 不可建造方格，多个传送器不能离得太近
    const UNBUILDABLE_RADIUS = 2;
    // 小范围内多少单位则不进行传送
    const TOO_MUCH_UNITS = 20;
    const TOO_MUCH_RADIUS = 12;

    const b = extendContent(Block, "teleporter-env", {
        borderRegion: null,
        wrapRegion: null,
        middleRegion: null,
        innerRegion: null,
        load() {
            this.borderRegion = this.reg("-border");
            this.innerRegion = this.reg("-inner");
            this.middleRegion = this.reg("-middle");
            this.wrapRegion = this.reg("-wrap");
            this.super$load();
        },
        configured(tile, player, value) {
            tile.ent().setTarget(value);
            tile.ent().setLastColor(BLUE);
            const other = Vars.world.tile(value);
            if (other && other.block() == this) {
                other.ent().setLastColor(ORANGE);
            }
        },
        isTeleportActive(entity) {
            return entity.getUptime() > 0.5;
        },
        canReplace(other) {
            if (!this.super$canReplace(other)) {
                return false;
            }
            return true;
            // TODO 不可建造范围内不准有传送器
        },
        hasEntity() {
            return true;
        },
        linkValid(tile, other, checkDouble) {
            if (other == null || tile == null || other.ent() == null || tile.ent() == null) {
                return false;
            }

            // 连了别人的节点不能连
            // 被连过的也不能连
            // 自己被连的不能连别人
            return other.block() == this
                && !tile.ent().getConnected()
                && (!other.ent().getConnected() || (tile.ent().getTarget() == other.pos()))
                && !(Vars.world.tile(other.ent().getTarget()))
                && tile.withinDst(other, RANGE * Vars.tilesize);
        },
        tryInvalidOriginTarget(tile) {
            var originOther = Vars.world.tile(tile.ent().getTarget());
            if (originOther != null && originOther.ent() != null && originOther.ent().getConnected()) {
                originOther.ent().setConnected(false);
            }
        },
        onConfigureTileTapped(tile, other) {
            var entity = tile.ent();

            if (tile == other) {
                this.tryInvalidOriginTarget(tile);
                tile.configure(Pos.invalid);
                return false;
            }
            if (this.linkValid(tile, other, true)) {
                this.tryInvalidOriginTarget(tile);
                if (entity.getTarget() == other.pos()) {
                    tile.configure(Pos.invalid);
                } else if (other.entity.getTarget() != tile.pos()) {
                    tile.configure(other.pos());
                }
                return false;
            }
            return true;
        },
        removed(tile) {
            this.tryInvalidOriginTarget(tile);
            this.super$removed(tile);
        },
        draw(tile) {
            this.super$draw(tile);
            const entity = tile.ent();
            if (entity.getUptime() > 0) {
                Draw.color(entity.getLastColor());
                Draw.alpha(Math.min(0.9, entity.getUptime()));
                Draw.rect(this.reg(this.innerRegion), tile.drawx(), tile.drawy(), Time.time());
                Draw.alpha(Math.min(0.6, entity.getUptime()));
                Draw.rect(this.reg(this.middleRegion), tile.drawx(), tile.drawy(), 360 - (Time.time() % 360));
                Draw.alpha(Math.min(0.4, entity.getUptime()));
                Draw.rect(this.reg(this.wrapRegion), tile.drawx(), tile.drawy());
                Draw.alpha(Math.min(1, entity.getUptime()));
                Draw.rect(this.reg(this.borderRegion), tile.drawx(), tile.drawy());
                Draw.reset();
            }
        },
        drawConfigure(tile) {
            var entity = tile.ent();

            Draw.color(Pal.accent);
            Lines.stroke(1);
            Lines.square(tile.drawx(), tile.drawy(),
                tile.block().size * Vars.tilesize / 2 + 1);

            var target;
            if (entity.getTarget() != Pos.invalid && (target = Vars.world.tile(entity.getTarget())) != null && this.linkValid(tile, target, true)) {
                var sin = Mathf.absin(Time.time(), 6, 1);

                Draw.color(Pal.place);
                Lines.square(target.drawx(), target.drawy(), target.block().size * Vars.tilesize / 2 + 1 + (Mathf.absin(Time.time(), 4, 1)));

                Draw.color(Pal.accent);
                Drawf.arrow(tile.drawx(), tile.drawy(), target.drawx(), target.drawy(), this.size * Vars.tilesize + sin, 4 + sin);
            }

            Drawf.dashCircle(tile.drawx(), tile.drawy(), RANGE * Vars.tilesize, Pal.accent);
        },
        drawPlace(x, y, rotation, valid) {
            const range = RANGE;
            const tilesize = Vars.tilesize;
            Drawf.dashCircle(x * tilesize, y * tilesize, range * tilesize, Pal.accent);

            // check if a mass driver is selected while placing this driver
            if (!Vars.control.input.frag.config.isShown()) return;
            var selected = Vars.control.input.frag.config.getSelectedTile();
            if (selected == null || !(selected.dst(x * tilesize, y * tilesize) <= range * tilesize)) return;

            // if so, draw a dotted line towards it while it is in range
            var sin = Mathf.absin(Time.time(), 6, 1);
            Tmp.v1.set(x * tilesize, y * tilesize).sub(selected.drawx(), selected.drawy()).limit((this.size / 2 + 1) * tilesize + sin + 0.5);
            var x2 = x * tilesize - Tmp.v1.x, y2 = y * tilesize - Tmp.v1.y,
                x1 = selected.drawx() + Tmp.v1.x, y1 = selected.drawy() + Tmp.v1.y;
            var segs = (selected.dst(x * tilesize, y * tilesize) / tilesize);

            Lines.stroke(2, Pal.gray);
            Lines.dashLine(x1, y1, x2, y2, segs);
            Lines.stroke(1, Pal.placing);
            Lines.dashLine(x1, y1, x2, y2, segs);
            Draw.reset();
        },
        drawLayer(tile) {
            // 连线
            const tilesize = Vars.tilesize;
            var entity = tile.ent();

            var opacity = Math.max(entity.getUptime(), 0.25) * Core.settings.getInt("bridgeopacity") / 100;
            if (Mathf.zero(opacity)) return;

            // 先画接收端
            if (entity.getConnected() && this.isTeleportActive(entity)) {
                // Draw.color(ORANGE);
                // Draw.alpha(opacity);
                // Lines.circle(tile.drawx(), tile.drawy(), TELEPORTER_RADIUS);
                if (Mathf.random(60) > 48) {
                    Time.run(Mathf.random(10), run(() => {
                        Effects.effect(outEffect, tile.drawx(), tile.drawy(), 0);
                    }));
                }
            }

            var other = Vars.world.tile(entity.getTarget());
            if (!this.linkValid(tile, other, true)) return;

            // Draw line between
            if (this.isTeleportActive(entity) && this.isTeleportActive(other.ent())) {
                var totalTime = 120;

                var angle = Angles.angle(tile.worldx(), tile.worldy(), other.worldx(), other.worldy());
                Lines.stroke(0.6);
                // Lines.line(tile.drawx(), tile.drawy(), other.drawx(), other.drawy());
                var spreadLength = Mathf.absin(Time.time(), 6, 1.6);
                spreadLength = 0.8 - spreadLength;
                var lineOffsetX = Angles.trnsx(angle, this.size * 4 + 2);
                var lineOffsetY = Angles.trnsy(angle, this.size * 4 + 2);
                Draw.color(ORANGE);
                Draw.alpha(opacity * 0.5);
                Lines.line(
                    other.drawx() + Angles.trnsx(angle + 90, spreadLength) - lineOffsetX,
                    other.drawy() + Angles.trnsy(angle + 90, spreadLength) - lineOffsetY,
                    tile.drawx() + Angles.trnsx(angle + 90, spreadLength) + lineOffsetX,
                    tile.drawy() + Angles.trnsy(angle + 90, spreadLength) + lineOffsetY
                );
                Draw.color(BLUE);
                Draw.alpha(opacity * 0.5);
                Lines.line(
                    tile.drawx() + Angles.trnsx(angle - 90, spreadLength) + lineOffsetX,
                    tile.drawy() + Angles.trnsy(angle - 90, spreadLength) + lineOffsetY,
                    other.drawx() + Angles.trnsx(angle - 90, spreadLength) - lineOffsetX,
                    other.drawy() + Angles.trnsy(angle - 90, spreadLength) - lineOffsetY
                );
            }

            // 画发送端
            if (this.isTeleportActive(entity) && this.isTeleportActive(other.ent())) {
                // Draw.color(BLUE);
                // Draw.alpha(opacity);
                // Lines.circle(tile.drawx(), tile.drawy(), TELEPORTER_RADIUS);
                if (Mathf.random(60) > 48) {
                    Time.run(Mathf.random(10), run(() => {
                        Effects.effect(inEffect, tile.drawx(), tile.drawy(), 0);
                    }));
                }
            }

            Draw.reset();

            // var angle = Angles.angle(tile.worldx(), tile.worldy(), other.worldx(), other.worldy());
            // Draw.color(Color.white, Color.black, Mathf.absin(Time.time(), 6, 0.07));
            // Draw.alpha(Math.max(entity.uptime, 0.25) * opacity);

            // Draw.rect(this.endRegion, tile.drawx(), tile.drawy(), angle + 90);
            // Draw.rect(this.endRegion, other.drawx(), other.drawy(), angle + 270);

            // Lines.stroke(8);
            // Lines.line(this.bridgeRegion, tile.worldx(), tile.worldy(), other.worldx(), other.worldy(), CapStyle.none, 0);

            // var dist = Math.max(Math.abs(other.x - tile.x), Math.abs(other.y - tile.y));

            // var time = entity.time2 / 1.7;
            // var arrows = (dist) * tilesize / 4 - 2;

            // Draw.color();

            // for (var a = 0; a < arrows; a++) {
            //     Draw.alpha(Mathf.absin(a / arrows - entity.time / 100, 0.1, 1) * entity.uptime * opacity);
            //     Draw.rect(this.arrowRegion,
            //         tile.worldx() + Angles.trnsx(angle, (tilesize / 2 + a * 4 + time % 4)),
            //         tile.worldy() + Angles.trnsy(angle, (tilesize / 2 + a * 4 + time % 4)), angle);
            // }
            // Draw.reset();
        },
        update(tile) {
            this.super$update(tile);

            var entity = tile.ent();
            var targetPos = entity.getTarget();
            var target = Vars.world.tile(targetPos);
            var shouldConsume = false;

            if (this.linkValid(tile, target, false)) {
                shouldConsume = true;
                target.ent().setConnected(true);
                if (this.isTeleportActive(entity) && this.isTeleportActive(target.ent())) {
                    // Try teleport units in range
                    // If too much units on target teleporter, abort.
                    var isTooMuch = (() => {
                        var counter = {
                            count: 0,
                            inited: false,
                            add() {
                                this.count++;
                                this.inited = true;
                            }
                        };
                        return function() {
                            if (!counter.inited) {
                                Units.nearby(tile.ent().getTeam(), target.drawx(), target.drawy(), TOO_MUCH_RADIUS, cons((unit) => {
                                    if (!unit.isFlying()) {
                                        counter.add();
                                    }
                                }));
                            }
                            return counter.count >= TOO_MUCH_UNITS;
                        }
                    })();
                    Units.nearby(tile.ent().getTeam(), tile.drawx(), tile.drawy(), TELEPORTER_RADIUS, cons((unit) => {
                        if (!unit.isFlying() && !isTooMuch()) {
                            // TELEPORT!
                            Effects.effect(unitInEffect, unit.x, unit.y, 0, {
                                getUnitSize() { return unit.size }
                            });
                            unit.set(target.drawx(), target.drawy());
                            Effects.effect(unitOutEffect, target.drawx(), target.drawy(), 0, {
                                getUnitSize() { return unit.size }
                            });
                        }
                    }));
                }
            }

            if (entity.getConnected()) {
                shouldConsume = true;
            }

            if (shouldConsume && entity.cons.valid() && Mathf.zero(1 - entity.efficiency())) {
                entity.setUptime(Mathf.lerpDelta(entity.uptime, 1, 0.04));
            } else {
                entity.setUptime(Mathf.lerpDelta(entity.uptime, 0, 0.02));
            }
        },
        // invincible
        handleDamage(tile, amount) { return 0; },
        handleBulletHit(entity, bullet) { },
    })

    b.update = true;
    b.posConfig = true;
    b.entityType = teleporterEntityProv;
    b.layer = Layer.power;
    return b;
})();
