const {
  DescribeVolumesCommand,
  DescribeImagesCommand,
  DescribeSnapshotsCommand
} = require('@aws-sdk/client-ec2');


/*
 * EBS pricing estimates.
 *
 * These are configurable so you can change them
 * if AWS pricing differs for your region/account.
 *
 * GP2 = $0.10 / GB-month
 * GP3 = $0.08 / GB-month
 *
 * EBS Snapshot = $0.05 / GB-month
 */
const GP2_PRICE_PER_GB = 0.10;
const GP3_PRICE_PER_GB = 0.08;
const SNAPSHOT_PRICE_PER_GB = 0.05;


/*
 * FinOps thresholds
 */
const AMI_AGE_DAYS = 90;
const SNAPSHOT_AGE_DAYS = 90;


/**
 * Analyze EBS volumes.
 *
 * Detects:
 *
 * 1. GP2 volumes that can potentially move to GP3
 * 2. Unattached volumes
 * 3. Volume-level information
 * 4. AMI optimization
 * 5. Snapshot optimization
 * 6. Orphaned snapshots
 */
async function analyzeEBS(ec2) {

  /*
   * ============================================================
   * EBS VOLUMES
   * ============================================================
   */

  let volumes = [];

  let nextToken;


  /*
   * Get all EBS volumes.
   */
  do {

    const response =
      await ec2.send(
        new DescribeVolumesCommand({
          MaxResults: 500,
          NextToken: nextToken
        })
      );

    volumes.push(
      ...(response.Volumes || [])
    );

    nextToken =
      response.NextToken;

  } while (nextToken);


  /*
   * GP2 volumes
   */
  const gp2Volumes =
    volumes.filter(
      volume =>
        volume.VolumeType === 'gp2'
    );


  /*
   * Unattached volumes.
   *
   * State = available means
   * the volume isn't attached
   * to an EC2 instance.
   */
  const unattachedVolumes =
    volumes.filter(
      volume =>
        volume.State === 'available'
    );


  /*
   * GP2 → GP3 savings.
   */
  const gp2ToGp3Candidates =
    gp2Volumes.map(volume => {

      const currentMonthlyCost =
        volume.Size *
        GP2_PRICE_PER_GB;


      const gp3MonthlyCost =
        volume.Size *
        GP3_PRICE_PER_GB;


      const estimatedMonthlySavings =
        currentMonthlyCost -
        gp3MonthlyCost;


      return {

        volumeId:
          volume.VolumeId,

        sizeGB:
          volume.Size,

        availabilityZone:
          volume.AvailabilityZone,

        state:
          volume.State,

        currentType:
          volume.VolumeType,

        recommendedType:
          'gp3',

        currentMonthlyCost:
          Number(
            currentMonthlyCost.toFixed(2)
          ),

        estimatedGp3MonthlyCost:
          Number(
            gp3MonthlyCost.toFixed(2)
          ),

        estimatedMonthlySavings:
          Number(
            estimatedMonthlySavings.toFixed(2)
          )

      };

    });


  /*
   * Unattached volume analysis.
   */
  const unattached =
    unattachedVolumes.map(volume => {

      const pricePerGB =
        volume.VolumeType === 'gp2'
          ? GP2_PRICE_PER_GB
          : GP3_PRICE_PER_GB;


      const estimatedMonthlyCost =
        volume.Size *
        pricePerGB;


      return {

        volumeId:
          volume.VolumeId,

        sizeGB:
          volume.Size,

        availabilityZone:
          volume.AvailabilityZone,

        state:
          volume.State,

        volumeType:
          volume.VolumeType,

        estimatedMonthlyCost:
          Number(
            estimatedMonthlyCost.toFixed(2)
          )

      };

    });


  /*
   * Total estimated GP2 → GP3 savings.
   */
  const gp2ToGp3Savings =
    gp2ToGp3Candidates.reduce(
      (sum, volume) =>
        sum +
        volume.estimatedMonthlySavings,
      0
    );


  /*
   * Total estimated cost of
   * unattached volumes.
   */
  const unattachedCost =
    unattached.reduce(
      (sum, volume) =>
        sum +
        volume.estimatedMonthlyCost,
      0
    );


  /*
   * ============================================================
   * AMI ANALYSIS
   * ============================================================
   */

  let images = [];

  let imageNextToken;


  /*
   * Get AMIs owned by this AWS account.
   */
  do {

    const response =
      await ec2.send(
        new DescribeImagesCommand({

          Owners: ['self'],

          MaxResults: 1000,

          NextToken:
            imageNextToken

        })
      );


    images.push(
      ...(response.Images || [])
    );


    imageNextToken =
      response.NextToken;

  } while (imageNextToken);


  /*
   * Current time.
   */
  const now =
    new Date();


  /*
   * AMI age threshold.
   */
  const amiCutoff =
    new Date(
      now.getTime() -
      AMI_AGE_DAYS *
      24 *
      60 *
      60 *
      1000
    );


  /*
   * AMIs older than 90 days.
   */
  const oldAMIs =
    images
      .filter(image => {

        if (
          !image.CreationDate
        ) {
          return false;
        }


        const creationDate =
          new Date(
            image.CreationDate
          );


        return (
          creationDate <
          amiCutoff
        );

      })
      .map(image => {

        const creationDate =
          new Date(
            image.CreationDate
          );


        const ageDays =
          Math.floor(
            (
              now.getTime() -
              creationDate.getTime()
            ) /
            (
              24 *
              60 *
              60 *
              1000
            )
          );


        /*
         * Find snapshots referenced
         * by this AMI.
         */
        const snapshotIds =
          (
            image.BlockDeviceMappings ||
            []
          )
            .map(
              mapping =>
                mapping.Ebs?.SnapshotId
            )
            .filter(Boolean);


        return {

          imageId:
            image.ImageId,

          name:
            image.Name ||
            'Unnamed AMI',

          description:
            image.Description ||
            '',

          creationDate:
            image.CreationDate,

          ageDays,

          state:
            image.State,

          architecture:
            image.Architecture,

          platform:
            image.Platform ||
            'linux',

          rootDeviceType:
            image.RootDeviceType,

          snapshotIds,

          sourceInstanceId:
            image.SourceInstanceId ||
            null

        };

      });


  /*
   * ============================================================
   * SNAPSHOT ANALYSIS
   * ============================================================
   */

  let snapshots = [];

  let snapshotNextToken;


  /*
   * Get snapshots owned by this account.
   */
  do {

    const response =
      await ec2.send(
        new DescribeSnapshotsCommand({

          OwnerIds: ['self'],

          MaxResults: 1000,

          NextToken:
            snapshotNextToken

        })
      );


    snapshots.push(
      ...(response.Snapshots || [])
    );


    snapshotNextToken =
      response.NextToken;

  } while (snapshotNextToken);


  /*
   * Build a set of snapshot IDs that
   * are referenced by existing AMIs.
   */
  const amiSnapshotIds =
    new Set();


  for (
    const image of images
  ) {

    const mappings =
      image.BlockDeviceMappings ||
      [];


    for (
      const mapping of mappings
    ) {

      const snapshotId =
        mapping.Ebs?.SnapshotId;


      if (
        snapshotId
      ) {

        amiSnapshotIds.add(
          snapshotId
        );

      }

    }

  }


  /*
   * Snapshots older than 90 days.
   */
  const oldSnapshots =
    snapshots
      .filter(snapshot => {

        if (
          !snapshot.StartTime
        ) {
          return false;
        }


        return (
          snapshot.StartTime <
          amiCutoff
        );

      })
      .map(snapshot => {

        const ageDays =
          Math.floor(
            (
              now.getTime() -
              new Date(
                snapshot.StartTime
              ).getTime()
            ) /
            (
              24 *
              60 *
              60 *
              1000
            )
          );


        const estimatedMonthlyCost =
          (
            snapshot.VolumeSize ||
            0
          ) *
          SNAPSHOT_PRICE_PER_GB;


        return {

          snapshotId:
            snapshot.SnapshotId,

          volumeId:
            snapshot.VolumeId ||
            null,

          sizeGB:
            snapshot.VolumeSize ||
            0,

          startTime:
            snapshot.StartTime,

          ageDays,

          description:
            snapshot.Description ||
            '',

          encrypted:
            snapshot.Encrypted === true,

          state:
            snapshot.State,

          referencedByAMI:
            amiSnapshotIds.has(
              snapshot.SnapshotId
            ),

          estimatedMonthlyCost:
            Number(
              estimatedMonthlyCost.toFixed(2)
            )

        };

      });


  /*
   * Orphaned snapshots.
   *
   * Here "orphaned" means the snapshot
   * is not referenced by any AMI owned
   * by this account.
   *
   * We don't automatically delete them.
   * They must be reviewed before deletion
   * because snapshots may still be used
   * for backup or recovery purposes.
   */
  const orphanedSnapshots =
    snapshots
      .filter(snapshot =>
        !amiSnapshotIds.has(
          snapshot.SnapshotId
        )
      )
      .map(snapshot => {

        const ageDays =
          snapshot.StartTime
            ? Math.floor(
                (
                  now.getTime() -
                  new Date(
                    snapshot.StartTime
                  ).getTime()
                ) /
                (
                  24 *
                  60 *
                  60 *
                  1000
                )
              )
            : 0;


        const estimatedMonthlyCost =
          (
            snapshot.VolumeSize ||
            0
          ) *
          SNAPSHOT_PRICE_PER_GB;


        return {

          snapshotId:
            snapshot.SnapshotId,

          volumeId:
            snapshot.VolumeId ||
            null,

          sizeGB:
            snapshot.VolumeSize ||
            0,

          startTime:
            snapshot.StartTime,

          ageDays,

          description:
            snapshot.Description ||
            '',

          encrypted:
            snapshot.Encrypted === true,

          state:
            snapshot.State,

          referencedByAMI:
            false,

          estimatedMonthlyCost:
            Number(
              estimatedMonthlyCost.toFixed(2)
            )

        };

      });


  /*
   * Snapshots older than 90 days
   * and orphaned at the same time.
   */
  const oldOrphanedSnapshots =
    oldSnapshots.filter(
      snapshot =>
        !snapshot.referencedByAMI
    );


  /*
   * Estimated monthly cost of
   * old snapshots.
   */
  const oldSnapshotCost =
    oldSnapshots.reduce(
      (sum, snapshot) =>
        sum +
        snapshot.estimatedMonthlyCost,
      0
    );


  /*
   * Estimated monthly cost of
   * orphaned snapshots.
   */
  const orphanedSnapshotCost =
    orphanedSnapshots.reduce(
      (sum, snapshot) =>
        sum +
        snapshot.estimatedMonthlyCost,
      0
    );


  /*
   * Estimated monthly cost of
   * old + orphaned snapshots.
   *
   * We use the union here so the same
   * snapshot isn't counted twice.
   */
  const cleanupSnapshotIds =
    new Set();


  for (
    const snapshot of oldSnapshots
  ) {

    cleanupSnapshotIds.add(
      snapshot.snapshotId
    );

  }


  for (
    const snapshot of orphanedSnapshots
  ) {

    cleanupSnapshotIds.add(
      snapshot.snapshotId
    );

  }


  const cleanupSnapshotCost =
    snapshots
      .filter(
        snapshot =>
          cleanupSnapshotIds.has(
            snapshot.SnapshotId
          )
      )
      .reduce(
        (sum, snapshot) =>
          sum +
          (
            snapshot.VolumeSize ||
            0
          ) *
          SNAPSHOT_PRICE_PER_GB,
        0
      );


  /*
   * ============================================================
   * RETURN COMPLETE FINOPS ANALYSIS
   * ============================================================
   */

  return {

    /*
     * Existing EBS information
     */
    total:
      volumes.length,

    gp2:
      gp2Volumes.length,

    gp3:
      volumes.filter(
        volume =>
          volume.VolumeType === 'gp3'
      ).length,

    unattached:
      unattached.length,

    gp2ToGp3Candidates,

    unattachedVolumes:
      unattached,

    estimatedMonthlySavings:
      Number(
        (
          gp2ToGp3Savings +
          unattachedCost
        ).toFixed(2)
      ),

    gp2ToGp3EstimatedSavings:
      Number(
        gp2ToGp3Savings.toFixed(2)
      ),

    unattachedEstimatedCost:
      Number(
        unattachedCost.toFixed(2)
      ),


    /*
     * ========================================================
     * AMI OPTIMIZATION
     * ========================================================
     */
    ami: {

      total:
        images.length,

      olderThan90Days:
        oldAMIs.length,

      candidates:
        oldAMIs,

      ageThresholdDays:
        AMI_AGE_DAYS

    },


    /*
     * ========================================================
     * SNAPSHOT OPTIMIZATION
     * ========================================================
     */
    snapshots: {

      total:
        snapshots.length,

      olderThan90Days:
        oldSnapshots.length,

      orphaned:
        orphanedSnapshots.length,

      oldOrphaned:
        oldOrphanedSnapshots.length,

      olderThan90DaysEstimatedMonthlyCost:
        Number(
          oldSnapshotCost.toFixed(2)
        ),

      orphanedEstimatedMonthlyCost:
        Number(
          orphanedSnapshotCost.toFixed(2)
        ),

      cleanupEstimatedMonthlyCost:
        Number(
          cleanupSnapshotCost.toFixed(2)
        ),

      ageThresholdDays:
        SNAPSHOT_AGE_DAYS,

      candidates:
        oldSnapshots,

      orphanedSnapshots,

      oldOrphanedSnapshots

    }

  };
}


/**
 * Build EBS / AMI / Snapshot recommendations.
 */
function buildEBSRecommendations(ebs) {

  const recommendations = [];


  /*
   * ============================================================
   * GP2 → GP3
   * ============================================================
   */

  if (
    ebs.gp2ToGp3Candidates.length > 0
  ) {

    recommendations.push({

      category:
        'EBS Storage',

      priority:
        'MEDIUM',

      icon:
        '💾',

      title:
        `Migrate ${ebs.gp2ToGp3Candidates.length} GP2 Volume${ebs.gp2ToGp3Candidates.length > 1 ? 's' : ''} to GP3`,

      description:
        `Found ${ebs.gp2ToGp3Candidates.length} GP2 volume${ebs.gp2ToGp3Candidates.length > 1 ? 's' : ''}. GP3 provides a lower storage price and baseline performance.`,

      monthlySaving:
        ebs.gp2ToGp3EstimatedSavings,

      action:
        'EC2 → Volumes → select GP2 volume → Modify Volume → change Volume Type to gp3',

      resources:
        ebs.gp2ToGp3Candidates

    });

  }


  /*
   * ============================================================
   * UNATTACHED EBS
   * ============================================================
   */

  if (
    ebs.unattachedVolumes.length > 0
  ) {

    recommendations.push({

      category:
        'EBS Storage',

      priority:
        'HIGH',

      icon:
        '🗑️',

      title:
        `Review ${ebs.unattachedVolumes.length} Unattached EBS Volume${ebs.unattachedVolumes.length > 1 ? 's' : ''}`,

      description:
        `These EBS volumes are currently in the "available" state and are not attached to an EC2 instance. Confirm ownership and retention requirements before deleting.`,

      monthlySaving:
        ebs.unattachedEstimatedCost,

      action:
        'EC2 → Volumes → filter State = available → verify ownership → snapshot if required → delete unused volumes',

      resources:
        ebs.unattachedVolumes

    });

  }


  /*
   * ============================================================
   * AMI > 90 DAYS
   * ============================================================
   */

  if (
    ebs.ami &&
    ebs.ami.candidates.length > 0
  ) {

    recommendations.push({

      category:
        'AMI Optimization',

      priority:
        'MEDIUM',

      icon:
        '📀',

      title:
        `Review ${ebs.ami.candidates.length} AMI${ebs.ami.candidates.length > 1 ? 's' : ''} Older Than 90 Days`,

      description:
        `Found ${ebs.ami.candidates.length} AMI${ebs.ami.candidates.length > 1 ? 's' : ''} older than ${AMI_AGE_DAYS} days. Review whether these images are still required before deregistering them and removing their associated snapshots.`,

      monthlySaving:
        0,

      action:
        'EC2 → AMIs → filter owned by me → review AMI age and usage → deregister obsolete AMIs → review associated snapshots',

      resources:
        ebs.ami.candidates

    });

  }


  /*
   * ============================================================
   * OLD SNAPSHOTS
   * ============================================================
   */

  if (
    ebs.snapshots &&
    ebs.snapshots.olderThan90Days > 0
  ) {

    recommendations.push({

      category:
        'Snapshot Optimization',

      priority:
        'MEDIUM',

      icon:
        '📦',

      title:
        `Review ${ebs.snapshots.olderThan90Days} EBS Snapshot${ebs.snapshots.olderThan90Days > 1 ? 's' : ''} Older Than 90 Days`,

      description:
        `Found ${ebs.snapshots.olderThan90Days} snapshots older than ${SNAPSHOT_AGE_DAYS} days. Review backup and retention requirements before deleting them.`,

      monthlySaving:
        ebs.snapshots.olderThan90DaysEstimatedMonthlyCost,

      action:
        'EC2 → Snapshots → Owned by me → review snapshots older than 90 days → verify retention requirements → delete obsolete snapshots',

      resources:
        ebs.snapshots.candidates

    });

  }


  /*
   * ============================================================
   * ORPHANED SNAPSHOTS
   * ============================================================
   */

  if (
    ebs.snapshots &&
    ebs.snapshots.orphaned > 0
  ) {

    recommendations.push({

      category:
        'Snapshot Optimization',

      priority:
        'HIGH',

      icon:
        '🗑️',

      title:
        `Review ${ebs.snapshots.orphaned} Orphaned EBS Snapshot${ebs.snapshots.orphaned > 1 ? 's' : ''}`,

      description:
        `Found ${ebs.snapshots.orphaned} snapshots that are not referenced by any AMI owned by this account. Confirm that they are not required for backup, recovery or other operational purposes before deletion.`,

      monthlySaving:
        ebs.snapshots.orphanedEstimatedMonthlyCost,

      action:
        'EC2 → Snapshots → identify snapshots not referenced by AMIs → verify backup requirements → delete obsolete snapshots',

      resources:
        ebs.snapshots.orphanedSnapshots

    });

  }


  return recommendations;

}


module.exports = {

  analyzeEBS,

  buildEBSRecommendations

};
