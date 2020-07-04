const floor = extendContent(Floor, "walk-floor", {
    isDeep() {
        return true;
    },
})

floor.oreScale = 0;
floor.oreThreshold = 0;
