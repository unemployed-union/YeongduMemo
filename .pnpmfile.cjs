module.exports = {
  hooks: {
    readPackage(pkg) {
      // This workspace uses Drizzle only on the server with better-sqlite3.
      // Its optional Expo driver peer otherwise pulls the mobile toolchain into Docker.
      if (pkg.name === 'drizzle-orm') {
        if (pkg.peerDependencies) delete pkg.peerDependencies['expo-sqlite'];
        if (pkg.peerDependenciesMeta) delete pkg.peerDependenciesMeta['expo-sqlite'];
      }
      return pkg;
    },
  },
};
