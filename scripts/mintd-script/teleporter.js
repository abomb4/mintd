
const lib = require('abomb4/lib');

const teleporterEntityProv = prov(() => {
    var target = Pos.invalid;
    return extend(TileEntity, {
        setTarget(v) { target = v; },
        getTarget() { return target; },
        // TODO Save Load
    });
});

const teleporter = (() => {

    // 传送生效范围
    const TELEPORTER_RADIUS = 16;
    // 传送距离，block 单位（x8 = 实际距离）
    const RANGE = 36;
    // 不可建造范围，多个传送器不能离得太近
    const UNBUILDABLE_RADIUS = 24;
    // 小范围内多少单位则不进行传送
    const TOO_MUCH_UNITS = 10;
    const TOO_MUCH_RADIUS = 6;


    const STATE_IDLE = 1;
    const STATE_IN = 2;
    const STATE_OUT = 3;

    const b = extendContent(Block, "teleporter", {

        load() {
            this.super$load();
        },
        configured(tile, player, value){
            tile.ent().setTarget(value);
        },
        hasEntity() {
            return true;
        },
        linkValid(tile, other, checkDouble) {
            if (other == null || tile == null) return false;

            if (checkDouble === undefined) { checkDouble = true; }
            return other.block() == this
                && (!checkDouble || other.ent().link != tile.pos())
                && tile.withinDst(other, RANGE * Vars.tilesize);
        },
        onConfigureTileTapped(tile, other) {
            var entity = tile.ent();

            if (this.linkValid(tile, other, true)) {
                if (entity.getTarget() == other.pos()) {
                    tile.configure(Pos.invalid);
                } else if (other.entity.getTarget() != tile.pos()) {
                    tile.configure(other.pos());
                }
                return false;
            }
            return true;
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

            var other = Vars.world.tile(entity.getTarget());
            if (!this.linkValid(tile, other, true)) return;

            var opacity = Core.settings.getInt("bridgeopacity") / 100;
            if (Mathf.zero(opacity)) return;

            // draw it

            var angle = Angles.angle(tile.worldx(), tile.worldy(), other.worldx(), other.worldy());
            Draw.color(Color.white, Color.black, Mathf.absin(Time.time(), 6, 0.07));
            Draw.alpha(Math.max(entity.uptime, 0.25) * opacity);

            Draw.rect(this.endRegion, tile.drawx(), tile.drawy(), angle + 90);
            Draw.rect(this.endRegion, other.drawx(), other.drawy(), angle + 270);

            Lines.stroke(8);
            Lines.line(this.bridgeRegion, tile.worldx(), tile.worldy(), other.worldx(), other.worldy(), CapStyle.none, 0);

            var dist = Math.max(Math.abs(other.x - tile.x), Math.abs(other.y - tile.y));

            var time = entity.time2 / 1.7;
            var arrows = (dist) * tilesize / 4 - 2;

            Draw.color();

            for (var a = 0; a < arrows; a++) {
                Draw.alpha(Mathf.absin(a / arrows - entity.time / 100, 0.1, 1) * entity.uptime * opacity);
                Draw.rect(this.arrowRegion,
                    tile.worldx() + Angles.trnsx(angle, (tilesize / 2 + a * 4 + time % 4)),
                    tile.worldy() + Angles.trnsy(angle, (tilesize / 2 + a * 4 + time % 4)), angle);
            }
            Draw.reset();
        },
        update(tile) {
            this.super$update(tile);

            var entity = tile.ent();
            var targetPos = entity.getTarget();
            var target = Vars.world.tile(targetPos);

            if (target) {
                // Try teleport units in range
                Units.nearby(tile.ent().getTeam(), tile.drawx(), tile.drawy(), RANGE, cons((unit) => {
                    if (!unit.isFlying()) {
                        // TELEPORT!
                        // If too much units on target teleporter, abort.
                        unit.set(target.drawx(), target.drawy());
                    }
                }));
            }
        },
    })

    b.update = true;
    b.posConfig = true;
    b.entityType = teleporterEntityProv;
    return b;
})();
