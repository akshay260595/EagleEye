const fs = require('fs');
const path = require('path');

const {
  S3Client,
  PutObjectCommand
} = require('@aws-sdk/client-s3');

const {
  fetchAllData,
  getClients
} = require('./server');

const {
  getResourceDetails
} = require('./resource-details');

const REGION =
  process.env.AWS_REGION ||
  'us-east-1';

const BUCKET =
  process.env.EAGLEEYE_BUCKET ||
  'eagleeye-finops-data-781415762881';

const s3 =
  new S3Client({
    region: REGION
  });


async function uploadJson(
  key,
  data
) {

  const body =
    JSON.stringify(
      data,
      null,
      2
    );

  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      ServerSideEncryption: 'AES256'
    })
  );

  console.log(
    `Uploaded: s3://${BUCKET}/${key}`
  );
}


async function main() {

  const now =
    new Date();

  const year =
    now.getFullYear();

  const month =
    now.getMonth();

  console.log('');
  console.log('==========================================');
  console.log(' EagleEye FinOps Report Generator');
  console.log('==========================================');
  console.log(`Region : ${REGION}`);
  console.log(`Bucket : ${BUCKET}`);
  console.log(`Year   : ${year}`);
  console.log(`Month  : ${month + 1}`);
  console.log('');

  console.log(
    'Fetching EagleEye FinOps data...'
  );

  const data =
    await fetchAllData(
      REGION,
      year,
      month
    );

  console.log(
    'Fetching detailed resource inventory...'
  );

  const clients =
    getClients(REGION);

  const resourceDetails =
    await getResourceDetails(
      clients
    );

  data.resourceDetails =
    resourceDetails;

  const report = {
    reportVersion: '1.0',
    generatedAt:
      new Date().toISOString(),

    source: 'EagleEye',

    region: REGION,

    data
  };

  /*
   * Latest report
   */
  await uploadJson(
    'latest/finops.json',
    report
  );

  /*
   * Historical report
   */
  const date =
    now.toISOString()
      .slice(0, 10);

  const historyKey =
    `history/${year}/${String(month + 1).padStart(2, '0')}/${date}.json`;

  await uploadJson(
    historyKey,
    report
  );

  /*
   * Local copy for verification
   */
  const localFile =
    path.join(
      __dirname,
      'finops-report-latest.json'
    );

  fs.writeFileSync(
    localFile,
    JSON.stringify(
      report,
      null,
      2
    )
  );

  console.log('');
  console.log('==========================================');
  console.log(' Report generation completed successfully');
  console.log('==========================================');
  console.log('');
  console.log(
    `S3 Latest: s3://${BUCKET}/latest/finops.json`
  );
  console.log(
    `S3 History: s3://${BUCKET}/${historyKey}`
  );
  console.log(
    `Local: ${localFile}`
  );
  console.log('');
}


main()
  .catch(error => {

    console.error('');
    console.error(
      'ERROR: FinOps report generation failed'
    );

    console.error(
      error
    );

    process.exit(1);

  });
