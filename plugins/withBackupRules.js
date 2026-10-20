/**
 * Android Auto Backup rules for sndemo (config plugin, applied at prebuild).
 * Back up the normal app data, but never the Telegram token in SecureStore:
 * restoring it on another phone would fail to decrypt, and it should not leave
 * this phone.
 */
const fs = require('fs');
const path = require('path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const FULL = `<?xml version="1.0" encoding="utf-8"?>
<!-- Android 11 and lower. Written by plugins/withBackupRules.js -->
<full-backup-content>
  <include domain="sharedpref" path="."/>
  <exclude domain="sharedpref" path="SecureStore"/>
</full-backup-content>
`;

const EXTRACT = `<?xml version="1.0" encoding="utf-8"?>
<!-- Android 12 and higher. Written by plugins/withBackupRules.js -->
<data-extraction-rules>
  <cloud-backup>
    <include domain="sharedpref" path="."/>
    <exclude domain="sharedpref" path="SecureStore"/>
  </cloud-backup>
  <device-transfer>
    <include domain="sharedpref" path="."/>
    <exclude domain="sharedpref" path="SecureStore"/>
  </device-transfer>
</data-extraction-rules>
`;

module.exports = function withBackupRules(config) {
  config = withDangerousMod(config, [
    'android',
    async (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'sndemo_backup_rules.xml'), FULL);
      fs.writeFileSync(path.join(dir, 'sndemo_data_extraction_rules.xml'), EXTRACT);
      return c;
    },
  ]);
  return withAndroidManifest(config, (c) => {
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(c.modResults);
    app.$['android:fullBackupContent'] = '@xml/sndemo_backup_rules';
    app.$['android:dataExtractionRules'] = '@xml/sndemo_data_extraction_rules';
    return c;
  });
};
