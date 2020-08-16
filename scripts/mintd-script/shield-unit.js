
const lib = require('mintd-script/lib');
const ShieldHolder = (() => {

    const SHIELD_ID = 0;

    const map = {}
    const WAVE_STRENGTH = 1600;     // 每波增血
    const DEFAULT_CHARGE = 5000;    // 默认血量
    const CHARGE_TIME = 15 * 60;    // 充能所需秒数
    const MAX_RADIUS = 42;          // 最大范围
    const MIN_RADIUS = 24;          // 最小范围
    const MAX_RADIUS_PRECENT = 0.5; // 最大范围临界血量
    const MIN_RADIUS_PERCENT = 0.2; // 最小范围临界血量

    function UnitShield(unit, bornWave) {

        function getMaxPower() {
            return DEFAULT_CHARGE + (bornWave - 1) * WAVE_STRENGTH;
        }

        var entity = {
            bornWave: bornWave,
            unit: unit,
            id: ++SHIELD_ID,
            power: getMaxPower(),
            broken: false,
            hit: 0,
            chargeEffectEnergy: 0,
            rechargeEnergy: 0,
        };
        function setPower(v) { entity.power = v; }
        function getPower() { return entity.power; }
        function setHit(v) { entity.hit = v; }
        function getHit() { return entity.hit; }
        function setChargeEffectEnergy(v) { entity.chargeEffectEnergy = v; }
        function getChargeEffectEnergy() { return entity.chargeEffectEnergy; }
        function setBroken(v) { entity.broken = v; }
        function getBroken() { return entity.broken; }
        function setRechargeEnergy(v) { entity.rechargeEnergy = v; }
        function getRechargeEnergy() { return entity.rechargeEnergy; }
        function setBornWave(v) { entity.bornWave = v; }
        function getBornWave() { return entity.bornWave; }

        function handleDamage(trait) {
            trait.absorb();
            Effects.effect(Fx.absorb, trait);
            setPower(getPower() - trait.getShieldDamage())
            if (getPower() <= 0) {
                setPower(0);
                setBroken(true);
            }
            setHit(1);
        }
        function activeRadius() {
            if (entity.broken) { return 0; }
            var percent = getPower() / DEFAULT_CHARGE;

            if (percent >= MAX_RADIUS_PRECENT) {
                return MAX_RADIUS;
            } else if (percent <= MIN_RADIUS_PERCENT) {
                return MIN_RADIUS;
            } else {
                return MIN_RADIUS + (percent - MIN_RADIUS_PERCENT) / (MAX_RADIUS_PRECENT - MIN_RADIUS_PERCENT) * (MAX_RADIUS - MIN_RADIUS);
            }
        }

        // Charge when broken, every frame.
        function recharge() {
            if (getBroken()) {
                setRechargeEnergy(getRechargeEnergy() + 1);
            }

            if (getRechargeEnergy() >= CHARGE_TIME) {
                // FULLY CHARGED! FEAR ME!
                setPower(getMaxPower());
                setBroken(false);
                setRechargeEnergy(0);
                Effects.effect(Fx.healWave, unit);
            }
        }

        function tryAbsorb() {
            const realRadius = activeRadius();
            if (getHit() > 0) {
                setHit(getHit() - 1 / 5 * Time.delta());
            }
            if (getChargeEffectEnergy() > 0) {
                setChargeEffectEnergy(getChargeEffectEnergy() - 1 / 4 * Time.delta());
            }
            var me = entity.unit;
            Vars.bulletGroup.intersect(me.x - realRadius, me.y - realRadius, realRadius * 2, realRadius * 2, cons((trait) => {
                if (trait.canBeAbsorbed()
                    && trait.getTeam() != me.getTeam()
                    && Mathf.dst(trait.getX(), trait.getY(), me.x, me.y) < realRadius) {

                    handleDamage(trait);
                }
            }));
        }

        function draw() {
            var x = entity.unit.x;
            var y = entity.unit.y;
            var rad = activeRadius();

            // shield
            if (getPower() == DEFAULT_CHARGE) {
                Draw.color(Color.valueOf("ffe33f"));
            } else {
                Draw.color(Pal.accent);
            }
            Lines.stroke(1.5);
            Draw.alpha(0.09 + 0.08 * getHit());
            Fill.circle(x, y, rad);
            Draw.alpha(1);
            Lines.circle(x, y, rad);

            // hit
            Draw.color(Color.white);
            Draw.alpha(entity.hit * 0.5);
            Fill.circle(x, y, activeRadius());
            Draw.color();

            // charge
            Draw.color(Pal.heal);
            Draw.alpha(entity.chargeEffectEnergy * 0.5);
            Fill.circle(x, y, activeRadius());
            Draw.color();

            Draw.reset();
        }
        function debugDump() {
            print('id: ' + entity.id + ', power: ' + getPower() + ', hit: ' + getHit() + ', broken: ' + getBroken() + ', player: ' + entity.unit);
        }
        return {
            setPower: setPower,
            getPower: getPower,
            setBornWave: setBornWave,
            getBornWave: getBornWave,
            setHit: setHit,
            getHit: getHit,
            setChargeEffectEnergy: setChargeEffectEnergy,
            getChargeEffectEnergy: getChargeEffectEnergy,
            setBroken: setBroken,
            getBroken: getBroken,
            setRechargeEnergy: setRechargeEnergy,
            getRechargeEnergy: getRechargeEnergy,

            recharge: recharge,
            defence() { tryAbsorb() },
            draw: draw,
            destory() { delete map[unit.id]; },
            debugDump: debugDump,
            writeSave(stream) {
                stream.writeInt(getBornWave());
                stream.writeFloat(getPower());
                stream.writeBoolean(getBroken());
                stream.writeFloat(getRechargeEnergy());
            },
        };
    }

    function getShield(unit, init, bornWave) {
        if (init || map[unit.id] == null) {
            map[unit.id] = new UnitShield(unit, bornWave);
        }
        return map[unit.id];
    }
    return {
        getShield: getShield,
        readSave(unit, stream) {
            var bornWave = stream.readInt();
            var power = stream.readFloat();
            var broken = stream.readBoolean();
            var rechargeEnergy = stream.readFloat();

            var shield = getShield(unit, false, bornWave);
            shield.setPower(power);
            shield.setBroken(broken);
            shield.setRechargeEnergy(rechargeEnergy);
            return shield;
        },
    };
})();

//
// 初始血量 1200，每波增加 800 ，到 100 波时大约有 80000
//

// 仅攻击核心的陆地敌人
const onlyCoreGroundUnit = (() => {

    // 每几波进行增加，设置 5 则第 6, 11, 16 波开始增加
    const WAVE_STEP_SIZE = 2;
    // 每次增加血量
    const ADD_LIFE = 800 * WAVE_STEP_SIZE;

    /**
     * 计算增加了几次生命值后对应的受伤值是多少
     *
     * @params {number} baseLife 基础生命值
     * @params {number} addLife  每次增加生命值
     * @params {number} addCount 增加次数
     */
    function damageMultipler(baseLife, addLife, addCount) {
        var realLife = baseLife + addCount * addLife;
        return baseLife / realLife;
    }

    /**
     * 与下一波之后触发，第一波波数为 2 ；
     * 若间隔为2，第一波不算，第二波增加，第三波不算，第四波增加
     */
    function stage(waveStepSize, wave) {
        return Math.floor((wave - 1) / waveStepSize);
    }

    return prov(() => {

        var myBornWave = (v => v)(Vars.state.wave);

        var shield = null;

        function waveDamageMultipler(health) {
            return damageMultipler(health, ADD_LIFE, stage(WAVE_STEP_SIZE, myBornWave));
        }

        const u = extend(GroundUnit, {
            getStartState() {
                // do nothing
                return new UnitState({});
            },
            targetClosest() {
                this.target = this.getClosestEnemyCore();
            },
            update() {
                this.super$update();
                // no state driven, so move in update()
                this.moveToCore(Pathfinder.PathTarget.enemyCores);
                if (shield) {
                    shield.defence();
                    shield.recharge();
                }
            },
            writeSave(stream, net) {
                // if (!writeSaveState) {
                //     writeSaveState = true;
                //     if (net !== undefined) {
                //         this.super$writeSave(stream, net);
                //     } else {
                //         this.super$writeSave(stream, false);
                //     }
                // }
                var item = this.item();
                var team = this.team;
                var interpolator = this.interpolator;
                var velocity = this.velocity();
                var maxAbsVelocity = this.maxAbsVelocity;
                var velocityPercision = this.velocityPercision;
                var rotation = this.rotation;
                var health = this.health;
                var x = this.x;
                var y = this.y;
                var status = this.status;
                var type = this.type;
                var spawner = this.spawner;

                if(item.item == null) item.item = Items.copper;

                // Unit.java
                stream.writeByte(team.id);
                stream.writeBoolean(this.isDead());
                stream.writeFloat(net ? interpolator.target.x : x);
                stream.writeFloat(net ? interpolator.target.y : y);
                stream.writeByte((Mathf.clamp(velocity.getX(), -maxAbsVelocity, maxAbsVelocity) * velocityPercision));
                stream.writeByte((Mathf.clamp(velocity.getX(), -maxAbsVelocity, maxAbsVelocity) * velocityPercision));
                stream.writeShort((rotation * 2));
                stream.writeInt(health);
                stream.writeByte(item.item.id);
                stream.writeShort(item.amount);
                status.writeSave(stream);

                // BaseUnit.java
                stream.writeByte(type.id);
                stream.writeInt(spawner);

                // self
                shield.writeSave(stream);
                // writeSaveState = false;
            },
            readSave(stream, revision) {
                // if (!writeSaveState) {
                //     writeSaveState = true;
                //     this.super$readSave(stream, revision);
                // }

                var velocityPercision = this.velocityPercision;

                // Unit.java
                var team = stream.readByte();
                var dead = stream.readBoolean();
                var x = stream.readFloat();
                var y = stream.readFloat();
                var xv = stream.readByte();
                var yv = stream.readByte();
                var rotation = stream.readShort() / 2;
                var health = stream.readInt();
                var itemID = stream.readByte();
                var itemAmount = stream.readShort();

                this.status.readSave(stream, revision);
                this.item().amount = itemAmount;
                this.item().item = Vars.content.item(itemID);
                this.dead = dead;
                this.team = Team.get(team);
                this.health = health;
                this.x = x;
                this.y = y;
                this.velocity().set(xv / velocityPercision, yv / velocityPercision);
                this.rotation = rotation;

                // BaseUnit.java
                this.loaded = true;
                var type = stream.readByte();
                this.spawner = stream.readInt();

                this.type = Vars.content.getByID(ContentType.unit, type);
                this.add();

                shield = ShieldHolder.readSave(this, stream);
                // writeSaveState = false;
            },
            draw() {
                this.super$draw();
                shield.draw();
            },
            removed() {
                this.super$removed();
                if (shield) {
                    shield.destory();
                    shield = null;
                }
            },
            calculateDamage(amount) {
                // 最低也有 0.000001 的伤害
                return Math.max(0.000001, amount * waveDamageMultipler(this.getType().health));
            },
            avoidOthers() {
                const realMass = this.mass();
                this.type.mass = 20;
                this.super$avoidOthers();
                this.type.mass = realMass;
            },
        });
        shield = ShieldHolder.getShield(u, true, myBornWave);
        return u;
    });
})();


const selfBoom = (() => {

    const bullet = new BombBulletType(220, 40, "shell");
    // const bullet = extendContent(BombBulletType, 'booomb', {});
    bullet.hitEffect = Fx.pulverize;
    bullet.lifetime = 30;
    bullet.speed = 1.1;
    bullet.instantDisappear = true;
    bullet.killShooter = true;

    const w = extend(Weapon, {
        load() {
            this.super$load();
        },
    });
    w.name = 'chain-blaster';
    w.reload = 120;
    w.bullet = bullet;
    w.inaccuracy = 0;
    w.shots = 1;
    w.recoil = 1;
    w.shootSound = Sounds.explosion;

    w.shake = 0.5;
    w.length = 1.5; // Y length
    return w;
})();

const unitType = (() => {

    const unit = extendContent(UnitType, 'shield-unit', {
        load() {
            this.create(onlyCoreGroundUnit);
            // this.weapon = terminatorMainWeapon;
            this.weapon = selfBoom;
            this.super$load();
        },
    })
    return unit;
})();
