const {
  DescribeInstancesCommand,
  DescribeVolumesCommand,
  DescribeImagesCommand,
  DescribeSnapshotsCommand
} = require('@aws-sdk/client-ec2');

const {
  DescribeDBInstancesCommand
} = require('@aws-sdk/client-rds');

const {
  ListBucketsCommand,
  GetBucketLifecycleConfigurationCommand
} = require('@aws-sdk/client-s3');

const {
  DescribeLogGroupsCommand
} = require('@aws-sdk/client-cloudwatch-logs');

const {
  DescribeTrailsCommand,
  GetTrailStatusCommand
} = require('@aws-sdk/client-cloudtrail');


async function getResourceDetails(clients) {

  const {
    ec2,
    rds,
    s3,
    logs,
    cloudtrail
  } = clients;


  // ==========================================================
  // EC2
  // ==========================================================

  const ec2Response =
    await ec2.send(
      new DescribeInstancesCommand({})
    );

  const ec2Instances = [];

  for (
    const reservation of
    ec2Response.Reservations || []
  ) {

    for (
      const instance of
      reservation.Instances || []
    ) {

      const nameTag =
        (instance.Tags || [])
          .find(
            tag => tag.Key === 'Name'
          );

      ec2Instances.push({

        instanceId:
          instance.InstanceId,

        instanceName:
          nameTag?.Value || '—',

        instanceType:
          instance.InstanceType,

        state:
          instance.State?.Name,

        privateIp:
          instance.PrivateIpAddress || '—',

        publicIp:
          instance.PublicIpAddress || '—'

      });

    }

  }


  // ==========================================================
  // RDS
  // ==========================================================

  const rdsResponse =
    await rds.send(
      new DescribeDBInstancesCommand({})
    );

  const rdsInstances =
    (rdsResponse.DBInstances || [])
      .map(
        db => ({

          identifier:
            db.DBInstanceIdentifier,

          endpoint:
            db.Endpoint?.Address || '—',

          engine:
            db.Engine,

          engineVersion:
            db.EngineVersion,

          instanceClass:
            db.DBInstanceClass,

          status:
            db.DBInstanceStatus

        })
      );


  // ==========================================================
  // EBS
  // ==========================================================

  const volumeResponse =
    await ec2.send(
      new DescribeVolumesCommand({})
    );

  const volumes =
    (volumeResponse.Volumes || [])
      .map(
        volume => {

          const nameTag =
            (volume.Tags || [])
              .find(
                tag => tag.Key === 'Name'
              );

          return {

            volumeId:
              volume.VolumeId,

            volumeName:
              nameTag?.Value || '—',

            size:
              volume.Size,

            type:
              volume.VolumeType,

            state:
              volume.State,

            encrypted:
              !!volume.Encrypted,

            attached:
              (volume.Attachments || [])
                .length > 0

          };

        }
      );


  // ==========================================================
  // AMI > 90 DAYS
  // ==========================================================

  const imageResponse =
    await ec2.send(
      new DescribeImagesCommand({
        Owners: ['self']
      })
    );

  const now =
    Date.now();

  const ninetyDays =
    90 *
    24 *
    60 *
    60 *
    1000;

  const oldAmis =
    (imageResponse.Images || [])
      .map(
        image => {

          const creation =
            new Date(
              image.CreationDate
            );

          return {

            amiId:
              image.ImageId,

            name:
              image.Name || '—',

            creationDate:
              image.CreationDate,

            ageDays:
              Math.floor(
                (
                  now -
                  creation.getTime()
                ) /
                (
                  24 *
                  60 *
                  60 *
                  1000
                )
              )

          };

        }
      )
      .filter(
        image =>
          image.ageDays >= 90
      )
      .sort(
        (a, b) =>
          b.ageDays -
          a.ageDays
      );


  // ==========================================================
  // SNAPSHOT > 90 DAYS
  // ==========================================================

  const snapshotResponse =
    await ec2.send(
      new DescribeSnapshotsCommand({
        OwnerIds: ['self']
      })
    );

  const oldSnapshots =
    (snapshotResponse.Snapshots || [])
      .map(
        snapshot => {

          const start =
            new Date(
              snapshot.StartTime
            );

          return {

            snapshotId:
              snapshot.SnapshotId,

            volumeId:
              snapshot.VolumeId || '—',

            description:
              snapshot.Description || '—',

            startTime:
              snapshot.StartTime,

            ageDays:
              Math.floor(
                (
                  now -
                  start.getTime()
                ) /
                (
                  24 *
                  60 *
                  60 *
                  1000
                )
              )

          };

        }
      )
      .filter(
        snapshot =>
          snapshot.ageDays >= 90
      )
      .sort(
        (a, b) =>
          b.ageDays -
          a.ageDays
      );


  // ==========================================================
  // S3 LIFECYCLE
  // ==========================================================

  const bucketResponse =
    await s3.send(
      new ListBucketsCommand({})
    );

  const buckets = [];

  for (
    const bucket of
    bucketResponse.Buckets || []
  ) {

    let lifecycleEnabled =
      false;

    try {

      await s3.send(
        new GetBucketLifecycleConfigurationCommand({

          Bucket:
            bucket.Name

        })
      );

      lifecycleEnabled =
        true;

    } catch (error) {

      if (
        error.name !==
        'NoSuchLifecycleConfiguration'
      ) {

        console.warn(
          `S3 lifecycle check failed for ${bucket.Name}:`,
          error.message
        );

      }

    }

    buckets.push({

      bucketName:
        bucket.Name,

      creationDate:
        bucket.CreationDate,

      lifecycleEnabled

    });

  }


  // ==========================================================
  // CLOUDWATCH LOG GROUPS
  // ==========================================================

  const logGroups = [];

  let nextToken;

  do {

    const response =
      await logs.send(
        new DescribeLogGroupsCommand({

          nextToken,

          limit:
            50

        })
      );

    for (
      const group of
      response.logGroups || []
    ) {

      logGroups.push({

        logGroupName:
          group.logGroupName,

        retentionInDays:
          group.retentionInDays ??
          null,

        storedBytes:
          group.storedBytes ||
          0

      });

    }

    nextToken =
      response.nextToken;

  } while (
    nextToken
  );


  // ==========================================================
  // CLOUDTRAIL
  // ==========================================================

  const trailResponse =
    await cloudtrail.send(
      new DescribeTrailsCommand({

        includeShadowTrails:
          true

      })
    );

  const trails = [];

  for (
    const trail of
    trailResponse.trailList || []
  ) {

    let isLogging =
      false;

    try {

      const status =
        await cloudtrail.send(
          new GetTrailStatusCommand({

            Name:
              trail.TrailARN ||
              trail.Name

          })
        );

      isLogging =
        !!status.IsLogging;

    } catch (error) {

      console.warn(
        `CloudTrail status failed for ${trail.Name}:`,
        error.message
      );

    }

    trails.push({

      name:
        trail.Name,

      arn:
        trail.TrailARN,

      homeRegion:
        trail.HomeRegion,

      isMultiRegionTrail:
        !!trail.IsMultiRegionTrail,

      isLogging,

      s3Bucket:
        trail.S3BucketName ||
        '—'

    });

  }


  return {

    ec2Instances,

    rdsInstances,

    volumes,

    oldAmis,

    oldSnapshots,

    buckets,

    logGroups,

    trails

  };

}


module.exports = {
  getResourceDetails
};
