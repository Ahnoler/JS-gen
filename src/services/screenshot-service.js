import * as screenshotDao from '../dao/screenshot-dao.js';
import * as trajectoryDao from '../dao/trajectory-dao.js';

export async function saveScreenshot({ fileName, imageData, stepIndex, trajectoryId }) {
  return screenshotDao.save({
    fileName,
    imageData, // Buffer
    fileSize: imageData.length,
    trajectoryId: trajectoryId || null,
    stepIndex: stepIndex || 0,
  });
}

export async function getScreenshotImage(id) {
  return screenshotDao.getImage(id);
}

export async function listByTrajectory(trajectoryId) {
  return screenshotDao.listByTrajectory(trajectoryId);
}
