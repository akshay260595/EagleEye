const {
    CloudWatchClient,
    GetMetricDataCommand
} = require("@aws-sdk/client-cloudwatch");

function createCloudWatchClient(region) {
    return new CloudWatchClient({
        region
    });
}

function getTimeRange(days = 30) {
    const endTime = new Date();
    const startTime = new Date();

    startTime.setDate(startTime.getDate() - days);

    return {
        startTime,
        endTime
    };
}

async function getMetricData(
    cloudwatch,
    namespace,
    metricName,
    dimensions,
    startTime,
    endTime
) {
    const command = new GetMetricDataCommand({
        StartTime: startTime,
        EndTime: endTime,

        MetricDataQueries: [
            {
                Id: "metric1",
                MetricStat: {
                    Metric: {
                        Namespace: namespace,
                        MetricName: metricName,
                        Dimensions: dimensions
                    },
                    Period: 3600,
                    Stat: "Average"
                },
                ReturnData: true
            }
        ]
    });

    const response = await cloudwatch.send(command);

    return response.MetricDataResults?.[0]?.Values || [];
}

function average(values) {
    if (!values || values.length === 0) {
        return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function maximum(values) {
    if (!values || values.length === 0) {
        return 0;
    }

    return Math.max(...values);
}


/* =========================================================
   EC2 IDLE DETECTION
   ========================================================= */

async function getEC2IdleMetrics(
    region,
    instanceId,
    days = 30
) {
    const cloudwatch = createCloudWatchClient(region);

    const { startTime, endTime } = getTimeRange(days);

    const dimension = [
        {
            Name: "InstanceId",
            Value: instanceId
        }
    ];

    const [
        cpu,
        networkIn,
        networkOut,
        diskRead,
        diskWrite
    ] = await Promise.all([
        getMetricData(
            cloudwatch,
            "AWS/EC2",
            "CPUUtilization",
            dimension,
            startTime,
            endTime
        ),

        getMetricData(
            cloudwatch,
            "AWS/EC2",
            "NetworkIn",
            dimension,
            startTime,
            endTime
        ),

        getMetricData(
            cloudwatch,
            "AWS/EC2",
            "NetworkOut",
            dimension,
            startTime,
            endTime
        ),

        getMetricData(
            cloudwatch,
            "AWS/EC2",
            "DiskReadOps",
            dimension,
            startTime,
            endTime
        ),

        getMetricData(
            cloudwatch,
            "AWS/EC2",
            "DiskWriteOps",
            dimension,
            startTime,
            endTime
        )
    ]);

    return {
        instanceId,

        avgCpu: average(cpu),
        maxCpu: maximum(cpu),

        avgNetworkIn: average(networkIn),
        avgNetworkOut: average(networkOut),

        avgDiskReadOps: average(diskRead),
        avgDiskWriteOps: average(diskWrite),

        evaluationDays: days
    };
}

function isEC2Idle(metrics) {
    return (
        metrics.avgCpu < 10 &&
        metrics.maxCpu < 20 &&
        metrics.avgNetworkIn < 10485760 &&
        metrics.avgNetworkOut < 10485760 &&
        metrics.avgDiskReadOps < 100 &&
        metrics.avgDiskWriteOps < 100
    );
}


/* =========================================================
   RDS IDLE DETECTION
   ========================================================= */

async function getRDSIdleMetrics(
    region,
    dbInstanceIdentifier,
    days = 30
) {
    const cloudwatch = createCloudWatchClient(region);

    const { startTime, endTime } = getTimeRange(days);

    const dimension = [
        {
            Name: "DBInstanceIdentifier",
            Value: dbInstanceIdentifier
        }
    ];

    const [
        cpu,
        connections,
        readIOPS,
        writeIOPS,
        networkIn,
        networkOut
    ] = await Promise.all([
        getMetricData(
            cloudwatch,
            "AWS/RDS",
            "CPUUtilization",
            dimension,
            startTime,
            endTime
        ),

        getMetricData(
            cloudwatch,
            "AWS/RDS",
            "DatabaseConnections",
            dimension,
            startTime,
            endTime
        ),

        getMetricData(
            cloudwatch,
            "AWS/RDS",
            "ReadIOPS",
            dimension,
            startTime,
            endTime
        ),

        getMetricData(
            cloudwatch,
            "AWS/RDS",
            "WriteIOPS",
            dimension,
            startTime,
            endTime
        ),

        getMetricData(
            cloudwatch,
            "AWS/RDS",
            "NetworkReceiveThroughput",
            dimension,
            startTime,
            endTime
        ),

        getMetricData(
            cloudwatch,
            "AWS/RDS",
            "NetworkTransmitThroughput",
            dimension,
            startTime,
            endTime
        )
    ]);

    return {
        dbInstanceIdentifier,

        avgCpu: average(cpu),

        avgConnections: average(connections),

        avgReadIOPS: average(readIOPS),

        avgWriteIOPS: average(writeIOPS),

        avgNetworkIn: average(networkIn),

        avgNetworkOut: average(networkOut),

        evaluationDays: days
    };
}

function isRDSIdle(metrics) {
    return (
        metrics.avgCpu < 10 &&
        metrics.avgConnections < 5 &&
        metrics.avgReadIOPS < 100 &&
        metrics.avgWriteIOPS < 100
    );
}


/* =========================================================
   EXPORTS
   ========================================================= */

module.exports = {
    getEC2IdleMetrics,
    isEC2Idle,

    getRDSIdleMetrics,
    isRDSIdle
};
