const cron = require('node-cron');
const EventEmitter = require('events');

class LibraryScanner extends EventEmitter {
  constructor(jellyfinClient, db) {
    super();
    this.jellyfinClient = jellyfinClient;
    this.db = db;
    this.cronJob = null;
    this.isScanning = false;
  }

  start() {
    const config = this.db.getConfig();
    
    const libraryIds = config.scanLibraryIds ? JSON.parse(config.scanLibraryIds) : [];
    
    if (libraryIds.length === 0 || !config.scanInterval) {
      console.log('Scanner not started: missing configuration');
      return;
    }

    if (this.cronJob) {
      this.cronJob.stop();
    }

    const intervalMinutes = Math.max(1, Math.floor(config.scanInterval / 60));
    const cronExpression = `*/${intervalMinutes} * * * *`;

    console.log(`Starting scanner with interval: ${intervalMinutes} minutes`);
    console.log(`Monitoring ${libraryIds.length} libraries: ${libraryIds.join(', ')}`);

    this.cronJob = cron.schedule(cronExpression, async () => {
      await this.scan();
    });

    this.scan();
  }

  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
    }
  }

  async scan() {
    if (this.isScanning) {
      console.log('Scan already in progress, skipping');
      return;
    }

    this.isScanning = true;
    this.emit('scanStarted');

    try {
      const config = this.db.getConfig();
      const scanState = this.db.getScanState();

      const libraryIds = config.scanLibraryIds ? JSON.parse(config.scanLibraryIds) : [];
      
      if (libraryIds.length === 0) {
        console.log('No libraries configured, skipping scan');
        return;
      }

      const lastScanTime = scanState?.lastScanTime || new Date(0).toISOString();
      
      console.log(`Scanning ${libraryIds.length} libraries for items since ${lastScanTime}`);

      const scanPromises = libraryIds.map(libraryId => 
        this.jellyfinClient.getNewItems(libraryId, lastScanTime)
          .catch(err => {
            console.error(`Error scanning library ${libraryId}:`, err.message);
            return [];
          })
      );

      const results = await Promise.all(scanPromises);
      const newItems = results.flat();

      console.log(`Found ${newItems.length} new items across all libraries`);

      this.emit('scanCompleted', { itemsFound: newItems.length });
      this.db.updateScanState(new Date().toISOString(), newItems.length);

    } catch (error) {
      console.error('Scan error:', error.message);
      this.emit('scanError', error);
    } finally {
      this.isScanning = false;
    }
  }

  restart() {
    this.stop();
    this.start();
  }

  getStatus() {
    return {
      isRunning: this.cronJob !== null,
      isScanning: this.isScanning
    };
  }
}

module.exports = LibraryScanner;
