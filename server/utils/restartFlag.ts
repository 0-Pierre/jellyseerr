import type { MainSettings } from '@server/lib/settings';
import * as semver from 'semver';

class RestartFlag {
  private settings: MainSettings;
  private mainProjectVersion?: string;
  private forkedFromVersion?: string;

  public initializeSettings(settings: MainSettings): void {
    this.settings = { ...settings };
  }

  public isSet(): boolean {
    return false;
  }

  isUpdateAvailable() {
    if (this.mainProjectVersion && this.forkedFromVersion) {
      return semver.gt(this.mainProjectVersion, this.forkedFromVersion);
    }
    return false;
  }
}

const restartFlag = new RestartFlag();

export default restartFlag;
