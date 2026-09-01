const {
    getEC2IdleMetrics,
    isEC2Idle
} = require("./cloudwatch");

async function main() {

    const region = "us-west-2";

    const instanceId = process.argv[2];

    if (!instanceId) {
        console.log("Usage:");
        console.log("node test-cloudwatch.js i-xxxxxxxx");
        process.exit(1);
    }

    console.log(`Checking EC2 instance: ${instanceId}`);
    console.log("Evaluating last 30 days...\n");

    try {

        const metrics = await getEC2IdleMetrics(
            region,
            instanceId,
            30
        );

        console.log("CloudWatch Metrics:");
        console.log("====================");

        console.log(
            "Average CPU:",
            metrics.avgCpu.toFixed(2),
            "%"
        );

        console.log(
            "Maximum CPU:",
            metrics.maxCpu.toFixed(2),
            "%"
        );

        console.log(
            "Average Network In:",
            metrics.avgNetworkIn
        );

        console.log(
            "Average Network Out:",
            metrics.avgNetworkOut
        );

        console.log(
            "Average Disk Read:",
            metrics.avgDiskReadOps
        );

        console.log(
            "Average Disk Write:",
            metrics.avgDiskWriteOps
        );

        console.log("\nIdle Status:");

        console.log(
            isEC2Idle(metrics)
                ? "🔴 IDLE CANDIDATE"
                : "🟢 ACTIVE"
        );

    } catch (error) {

        console.error(
            "CloudWatch error:",
            error.message
        );

    }
}

main();
