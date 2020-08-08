
const lib = require('mintd-script/lib');

const floor = extendContent(Floor, "walk-floor-white", {
    isDeep() {
        return true;
    },
    load() {
        this.super$load();
        this.oreScale = 0;
        this.oreThreshold = 0;
    },
    edgeOnto(other) { return false; }
})
