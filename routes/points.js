const extract = require('../services/extract');
var express = require('express');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { v4: uuidv4 } = require('uuid');

var router = express.Router();

// debug stuff
var debugModule = require('debug');
var info = debugModule('points:info');
var debug = debugModule('points:debug')
// debug module basicaly use std error output, we'll use std out
debug.log = console.log.bind(console);
info.log = console.log.bind(console);

const eptFilename = process.env.EPT_JSON || '/media/data/EPT_SUD_Vannes/EPT_4978/ept.json';
const pivotFile = process.env.PIVOT_THREEJS  || '/media/data/EPT_SUD_Vannes/metadata/pivotTHREE.json';

// RETURN_URL env var: true: avoid using the response to send the file; upload the file to the store, and redirect the request.
// RETURN_URL env var: false:  in dev mode, if you don't have S3 file store.
const returnUrlString = process.env.RETURN_URL || 'true';
const returnUrl = returnUrlString === 'true';

// WRITE_PDAL_PIPELINE_FILE env var: true: Write the PDAL pipeline file on the disk, to debug, make code sync (bad thing)
// WRITE_PDAL_PIPELINE_FILE env var: false: Default behavior
const writePdalPipelineFileString = process.env.WRITE_PDAL_PIPELINE_FILE || 'false';
const writePdalPipelineFile = writePdalPipelineFileString === 'true';

const storeWriteUrl = process.env.STORE_WRITE_URL;
const storeReadUrl = process.env.STORE_READ_URL;

const tmpFolder = './tmp';

function init() {
  extract.init(pivotFile);
}

init();

// 0 means no limit
// const area_limit_in_square_meter = 0;
const area_limit_in_square_meter = process.env.SURFACE_MAX  || 100000;

function removeFileASync(file) {
  fs.rm(file, { recursive:true }, (err) => {
    if(err){
      info(err.message);
    }
  })
}

/* GET points listing. */
router.get('/', function(req, res, next) {
  
  let p = req.params;

  let polygon = req.query.poly;

  if (!polygon) {
    info("Bad Request: You must specify a polygon to crops")
    res.status(400).send('Bad Request: You must specify a polygon to crop\n');
    return;
  }

  polygon = polygon.replace(/_/g, ' ');
  polygon_points = polygon.split(',')

  if (polygon_points.length < 3) {
    info("Bad Request: Polygon must have at least 3 points")
    res.status(400).send("Bad Request: Polygon must have at least 3 points\n");
    return;
  }
  // Manage Invalid ring. When First point is not equal to the last point.
  if (polygon_points[0] != polygon_points[polygon_points.length - 1]) {
    polygon += ',' + polygon_points[0]
  }

  const algo = {};
  algo.polygon = polygon;
  // compute bounding box
  [algo.x1, algo.x2, algo.y1, algo.y2] = extract.computeBoundingBox(polygon_points);
  debug('bbox: x: ' + algo.x1 + ' to ' + algo.x2 + ' ; y: ' + algo.y1 + ' to ' + algo.y2)

  // compute area
  const area = extract.computeArea(algo.x1, algo.x2, algo.y1, algo.y2);

  // limit on area
  if (area_limit_in_square_meter > 0 && area > area_limit_in_square_meter) {
    const msg = 'Bad Request: Area is to big ('+ area + 'm²) ; limit is set to ' + area_limit_in_square_meter + 'm²)';
    info(msg);
    res.status(400).send(msg + '\n');
    return;
  }

  // create hash
  const hash = extract.computeHash(polygon);

  // create current date
  const date = extract.computeTodayDateFormatted();

	// check if file exist in the cache
  const filename = 'lidar_x_' + Math.floor(algo.x1) + '_y_' + Math.floor(algo.y1) + '.las';

  const storedFileRead = storeReadUrl + '/' + date + '/' + hash + '/' + filename;
  
  const storedFileWrite = storeWriteUrl + '/' + date + '/' + hash + '/' + filename;

  algo.filename = filename;
  algo.storedFileRead = storedFileRead;
  algo.storedFileWrite = storedFileWrite;

  if (returnUrl) {

    // test file existence on the store
    const wget = 'wget --spider ' + storedFileRead;
    debug('call wget subprocess : ' + wget);
    const ret = spawnSync('wget', ['--spider', storedFileRead]);
    if (ret.error) {
      console.log('Error', ret.error);
      throw new Error(ret.error);
    }

    // if file exist, return the URL
    if (ret.status == 0) {
      info('File exist on the store, return URL: ' + storedFileRead);
      res.redirect(storedFileRead);
      return
    }
  }

  extractPointCloud(next, res, algo);
});

function extractPointCloud(next, res, algo) {

  // use uniqe id
  const unique_id = uuidv4();
  const newFile = tmpFolder + '/' + unique_id + '-' + algo.filename;

  
  // compute pdal pipeline file
  const pdalPipelineFilename = tmpFolder + '/' + unique_id + '-pipeline.json';
  const pdalPipelineJSON = extract.computePdalPipeline(eptFilename, algo.polygon, newFile, algo.x1, algo.x2, algo.y1, algo.y2);

  // spawn child process
  const child = extract.spawnPdal(next, pdalPipelineJSON, writePdalPipelineFile, pdalPipelineFilename);

  child.on('close', (code) => {

    debug('done');

    if (code == 0) {

      if (returnUrl) {

        storeFileAndReturnStoreURL(next, res, newFile, algo.storedFileRead, algo.storedFileWrite);
      } else {

        sendFileInTheResponse(res, newFile, algo.filename);
      }
    }
  });

}

function storeFileAndReturnStoreURL(next, res, newFile, storedFileRead, storedFileWrite) {

  const child = extract.spawnS3cmdPut(next, newFile, storedFileWrite)

  child.on('close', (code) => {

    removeFileASync(newFile);

    debug('done');
    if (code == 0) {

      info('Return URL: ' + storedFileRead);
      res.redirect(storedFileRead);
    }
  });

}

function sendFileInTheResponse(res, newFile, filename) {

  const outputFile = path.resolve(__dirname, '../' + newFile);
  res.setHeader('Content-disposition', 'attachment; filename=' + filename);

  info('send:', newFile);
  res.sendFile(outputFile, {}, function (err) {

    if(err){
      info(err.message);
    }

    removeFileASync(newFile);
  });
}

module.exports = router;
