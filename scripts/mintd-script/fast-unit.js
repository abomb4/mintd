
const lib = require('mintd-script/lib');

//
// 初始血量 800，每波增加 300 ，到 100 波时大约有 30000
//

// 仅攻击核心的陆地敌人
const onlyCoreGroundUnit = (() => {

    // 每几波进行增加，设置 5 则第 6, 11, 16 波开始增加
    const WAVE_STEP_SIZE = 1;
    // 每次增加血量
    const ADD_LIFE = 300 * WAVE_STEP_SIZE;

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
            },
            calculateDamage(amount) {
                // 最低也有 0.000001 的伤害
                return Math.max(0.000001, amount * waveDamageMultipler(this.getType().health));
            },
        });
        return u;
    });
})();


const selfBoom = (() => {

    const bullet = new BombBulletType(100, 40, "shell");
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

    // const unit = extendContent(UnitType, 'terminator-unit', {
    //     load() {
    //         this.create(prov(() => new GroundUnit()));
    //         this.weapon = superWeapon;
    //         this.super$load();
    //     },
    // });
    const unit = extendContent(UnitType, 'fast-unit', {
        load() {
            this.create(onlyCoreGroundUnit);
            // this.weapon = terminatorMainWeapon;
            this.weapon = selfBoom;
            this.super$load();
        },
    })
    return unit;
})();
