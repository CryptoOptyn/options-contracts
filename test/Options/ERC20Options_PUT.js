const {getContracts, timeTravel, toWei, OptionType} = require("../utils/utils.js")
const {testPutPrices} = require("./Prices.js")
const toBN = web3.utils.toBN
const toBTC = x=> toBN(toWei(x)).div(toBN(1e10))
const priceTestPoints = [ 50, 75, 95, 100, 105, 125, 150, 1000]

module.exports.test = () => contract("ERC20Options WBTC(put)", ([user1, user2, user3, user4]) => {

const marketId = 0;

   before(async () => {  
    const { WBTC, ERC20Options, ERC20LiquidityPool } = await contracts
    var lots = "99999999999999999999999";
    await WBTC.mintTo(user1, lots)
    await WBTC.approve(ERC20Options.address, lots, { from: user1 })
    await WBTC.approve(ERC20LiquidityPool.address, lots, { from: user1 })
    await WBTC.mintTo(user2, lots)
    await WBTC.approve(ERC20Options.address, lots, { from: user2 })
    await WBTC.approve(ERC20LiquidityPool.address, lots, { from: user2 })
    await WBTC.mintTo(user3, lots)
    await WBTC.approve(ERC20Options.address, lots, { from: user3 })
    await WBTC.approve(ERC20LiquidityPool.address, lots, { from: user3 })
    await WBTC.mintTo(user4, lots)
    await WBTC.approve(ERC20Options.address, lots, { from: user4 })
    await WBTC.approve(ERC20LiquidityPool.address, lots, { from: user4 })

    await provideFunds();
   })
  
  const contracts = getContracts()
  const pricesBuf = []

  async function createOption(params = {}) {
    const {period, amount, strike, user} = params
    const {ERC20Options, ERC20LiquidityPool, BTCPriceProvider} = await contracts
    const [_period, _amount, _strike, from] = [
      toBN(24 * 3600 * (period || 1)),
      toBN(amount || toBTC(0.001)),
      toBN(strike || (await BTCPriceProvider.latestAnswer())),
      user || user1,
    ]
    const _type = OptionType.Put
    const [value, settlementFee] = await ERC20Options.fees(
      _period,
      _amount,
      _strike,
      _type,
      marketId
    ).then((x) => [x.totalETH, x.settlementFee])


    // console.log("_period:" +_period);
    // console.log("_amount:" +_amount);
    // console.log("_strike:" +_strike);
    // console.log("_type:" + _type);
    // console.log("value:" + value);    

    const createEvent = await ERC20Options.create3(_period, _amount, _strike, _type, marketId, {
            // value,
            from,
        })
        .then((x) => x.logs.find((x) => x.event == "Create"))
        .then((x) => (x ? x.args : null))
    assert.isNotNull(createEvent, "'Create' event has not been initialized")
    assert.equal(createEvent.account, from, "Wrong account")
    // assert(value.eq(createEvent.totalFee), "Wrong premium value")
    // assert(
    //   toBN(settlementFee).eq(createEvent.settlementFee),
    //   "Wrong settlementFee value"
    // )
    // assert(
    //   _amount.div(toBN(100)).eq(createEvent.settlementFee),
    //   "Wrong settlementFee value"
    // )
    return createEvent
  }

  async function testOption(params = {}) {
    const {ERC20Options, BTCPriceProvider} = await contracts
    const backupPrice = await BTCPriceProvider.latestAnswer()

    const period = params.period || 1
    const amount = toBN(params.amount || toBTC(1))
    const user = params.user || user1
    const createPrice = toBN(params.createPrice || backupPrice)
    const strike = toBN(params.strike || createPrice)
    const exercisePrice = toBN(params.exercisePrice || createPrice)

    await BTCPriceProvider.setPrice(createPrice)
    const {id, totalFee} = await createOption({period, amount, user, strike})
    await BTCPriceProvider.setPrice(exercisePrice)

    let result

    if (exercisePrice.gt(strike)) {
      await ERC20Options.exercise(id).then(
        () => assert.fail("Exercising a put option should be canceled"),
        (x) => {
          assert.equal(
            x.reason,
            "Current price is too high",
            "Wrong error reason"
          )
          result = "rejected"
        }
      )
    } else {
      const locked = toBN(await ERC20Options.options(id).then(x => x.lockedAmount));
      const countedProfit = amount
        .mul(strike.sub(exercisePrice))
        .div(exercisePrice)
      const expectedProfit = countedProfit.gt(locked) ? locked : countedProfit
      const startBalance = await web3.eth.getBalance(user1)
      const {profit} = await ERC20Options.exercise(id).then(
        (x) => x.logs.find((x) => x.event == "Exercise").args
      )
      const endBalance = await web3.eth.getBalance(user1)
      assert(
        amount.mul(strike).div(toBN(1e8)).gte(expectedProfit),
        "too large expected profit"
      )
      assert.equal(
        profit.toString(),
        expectedProfit.toString(),
        "wrong profit amount (1)"
      )
      // assert.equal(
      //   endBalance.sub(startBalance).toString(),
      //   expectedProfit.toString(),
      //   "wrong profit amount (2)"
      // )
      result = profit / 1e18
    }

    const usdFee = totalFee.mul(createPrice) / 1e26

    pricesBuf.push({
      period,
      amount: amount / 1e18,
      createPrice: createPrice / 1e8,
      strike: strike / 1e8,
      exercisePrice: exercisePrice / 1e8,
      totalFee: totalFee / 1e18,
      usdFee,
      profit: result,
      profitSF: typeof result == "number" ? result - totalFee : result,
    })

    await BTCPriceProvider.setPrice(backupPrice)
  }
  describe('Test put prices', () => {
    testPutPrices(marketId, contracts.then(x => [x.ERC20Options, x.BTCPriceProvider]))
  });

  describe('Test option & pool', () => {
    it("Should be owned by the first account", async () => {
      const { ERC20Options } = await contracts
      assert.equal(
        await ERC20Options.owner.call(),
        user1,
        "The first account isn't the contract owner"
      )
    })

    it("Should be the owner of the pool contract", async () => {
      const { ERC20Options, ERC20LiquidityPool } = await contracts
      assert.equal(
        await ERC20LiquidityPool.owner(),
        ERC20Options.address,
        "Isn't the owner of the pool"
      )
    })


    it("Should provide funds to the pool", async () => {
      const { ERC20LiquidityPool, WBTC } = await contracts
      const value = toWei(50)
      await WBTC.mint(value, { from: user4 })
      await WBTC.approve(ERC20LiquidityPool.address, value, { from: user4 })
      await ERC20LiquidityPool.provide(value, 0, WBTC.address, { from: user4 })
    })

    it("Should create an option", async () => {
      const { ERC20LiquidityPool, WBTC, ERC20Options } = await contracts
      await provideFunds();

      const createEvent = await createOption({ user: user4 })
      assert(
        createEvent.id.eq(toBN(0)),
        "The first option's ID isn't equal to 0"
      )
    })

    it("Should exercise an option", async () => {
      const { ERC20Options } = await contracts
      const { id } = await createOption()
      await timeTravel(15 * 60)
      const { amount } = await ERC20Options.options(id)
      const exerciseEvent = await ERC20Options.exercise(id)
        .then((x) => x.logs.find((log) => log.event == "Exercise"))
        .then((x) => (x ? x.args : null))
        .catch((x) => assert.fail(x.reason || x))
      assert.isNotNull(exerciseEvent, "'Exercise' event has not been initialized")
      // assert.equal(
      //   exerciseEvent.id.toNumber(),
      //   id,
      //   "Wrong option ID has been initialized"
      // )
    })

    it("Shouldn't exercise other options", async () => {
      const { ERC20Options } = await contracts
      const { id } = await createOption()
      await ERC20Options.exercise(id, { from: user2 }).then(
        () => assert.fail("Exercising a put option should be canceled"),
        (x) => {
          assert.equal(x.reason, "Wrong msg.sender", "Wrong error reason")
        }
      )
    })

    it("Shouldn't unlock an active option", async () => {
      provideFunds();
      const period = parseInt(Math.random() * 28 + 1)
      const { ERC20Options } = await contracts
      const { id } = await createOption({ period })
    
      // let option = await ERC20Options.options(id);
      // let blockNum = await web3.eth.getBlockNumber()
      // let block = await web3.eth.getBlock(blockNum)
      // console.log("option.expiration:", option.expiration.toString());
      // console.log("block[‘timestamp’]:", block['timestamp']);
      // console.log("option.state:", option.state.toString());
    
      const test = () =>
        ERC20Options.unlock(id).then(
          () => assert.fail("Exercising a put option should be canceled"),
          (x) => {
            // console.log("x:",x)
            assert.equal(
              x.reason,
              "Option has not expired yet",
              "Wrong error reason"
            )
          }
        )
      await test()
      timeTravel(3600 * 24 * period - 10)
      await test() //TODO: second one is failing 
    })

    it("Shouldn't exercise an expired option", async () => {
      const period = parseInt(Math.random() * 28 + 1)
      const { ERC20Options } = await contracts
      const { id } = await createOption({ period, user: user2 })
      await timeTravel(period * 24 * 3600 + 1)
      await ERC20Options.exercise(id, { from: user2 }).then(
        () => assert.fail("Exercising a put option should be canceled"),
        (x) => {
          assert.equal(x.reason, "Option has expired", "Wrong error reason")
        }
      )
    })

    it("Shouldn't unlock an exercised option", async () => {
      const { ERC20Options } = await contracts
      const { id } = await createOption({ user: user2 })
      await ERC20Options.exercise(id, { from: user2 })
      await timeTravel(24 * 3600 + 1)
      await ERC20Options.unlock(id).then(
        () => assert.fail("Exercising a put option should be canceled"),
        (x) => {
          assert.equal(x.reason, "Option is not active", "Wrong error reason")
        }
      )
    })

    it("Should unlock expired options", async () => {
      const { ERC20Options } = await contracts
      const EXPIRED = toBN(3)
      const expected = await Promise.all([
        createOption({ period: 3, user: user3 }),
        createOption({ period: 3, user: user1 }),
        createOption({ period: 3, user: user2 }),
        createOption({ period: 3, user: user2, amount: toBTC(4) }),
      ]).then((x) => x.map((x) => x.id.toNumber()))

      await timeTravel(3 * 24 * 3600 + 1)

      const actual = await ERC20Options.unlockAll(expected)
        .then((x) => x.logs.filter((x) => x.event == "Expire"))
        .then((x) => x.map((x) => x.args.id.toNumber()))

      assert.deepEqual(expected, actual, "Wrong optionIDs has been initialized")
      for (const id of expected) {
        const option = await ERC20Options.options(id)
        assert(option.state.eq(EXPIRED), `option ${id} is not expired`)
      }
    })

    it("Should lock funds correctly", async () => {
      const { ERC20LiquidityPool, ERC20Options, WBTC } = await contracts
      const startLockedAmount = await ERC20LiquidityPool.lockedAmount(WBTC.address)
      const amount = toBN(toBTC(Math.random().toFixed(18)))
      // const strike = toBN(11000e8)
      const { id } = await createOption({ amount })
      const endLockedAmount = await ERC20LiquidityPool.lockedAmount(WBTC.address)
      // TODO: expected
      const expected = toBN(await ERC20Options.options(id).then(x => x.lockedAmount))
      const actual = endLockedAmount.sub(startLockedAmount)
      assert(expected.eq(actual), "was locked incorrect amount")
    })

    it("Should unlock funds after an option is exercised", async () => {
      const { ERC20Options, ERC20LiquidityPool, WBTC } = await contracts
      const amount = toBN(toBTC(Math.random().toFixed(18)))
      // const strike = toBN(11000e8)
      const { id } = await createOption({ amount })
      const startLockedAmount = await ERC20LiquidityPool.lockedAmount(WBTC.address)
      await ERC20Options.exercise(id)
      const endLockedAmount = await ERC20LiquidityPool.lockedAmount(WBTC.address)
      // TODO: expected
      const expected = toBN(await ERC20Options.options(id).then(x => x.lockedAmount))
      const actual = startLockedAmount.sub(endLockedAmount)
      assert.equal(
        actual.toString(),
        expected.toString(),
        "was locked incorrect amount"
      )
    })

    it("Shouldn't change pool's total amount when creates an option", async () => {
      await provideFunds();
      const { WBTC, ERC20LiquidityPool } = await contracts
      const startTotalBalance = await ERC20LiquidityPool.totalBalance(WBTC.address)
      const amount = toBN(toBTC(Math.random().toFixed(18)))
      const strike = toBN(11000e8)
      const { id } = await createOption({ amount, strike })
      const endTotalBalance = await ERC20LiquidityPool.totalBalance(WBTC.address)
      assert(
        startTotalBalance.eq(endTotalBalance),
        `total amount was changed ${startTotalBalance} -> ${endTotalBalance}`
      )
    })

    it("Shouldn't change users' share when creates an option", async () => {
      const { ERC20LiquidityPool, WBTC } = await contracts
      const startShares = await Promise.all(
        [user1, user2, user3].map((user) => ERC20LiquidityPool.shareOf(user, WBTC.address))
      ).then((x) => x.toString())
      const amount = toBN(toBTC(Math.random().toFixed(18)))
      const strike = toBN(11000e8)
      const { id } = await createOption({ amount, strike })
      const endTotalBalance = await ERC20LiquidityPool.totalBalance(WBTC.address)
      const endShares = await Promise.all(
        [user1, user2, user3].map((user) => ERC20LiquidityPool.shareOf(user,WBTC.address))
      ).then((x) => x.toString())
      assert.deepEqual(startShares, endShares, `share was changed`)
    })

    it("Should unfreeze LP's profit correctly after an option is unlocked", async () => {
      await provideFunds();
    
      const { ERC20LiquidityPool, ERC20Options, WBTC } = await contracts
      const startTotalBalance = await ERC20LiquidityPool.totalBalance(WBTC.address)
      const amount = toBN(toBTC(Math.random().toFixed(18)))
      const strike = toBN(11000e8)
      const { id } = await createOption({ amount, strike })
      // const {premium} = await ERC20Options.options(id)
      timeTravel(24 * 3600 + 1)
      const { premium } = await ERC20Options.unlock(id)
        .then((x) => x.logs.find((x) => x.event == "Expire"))
        .then((x) => x.args)
      const endTotalBalance = await ERC20LiquidityPool.totalBalance(WBTC.address)

      assert.equal(
        startTotalBalance.add(premium).toString(),
        endTotalBalance.toString(),
        `profit was unlocked incorrectly`
      )
      assert.equal(
        premium.toString(),
        await ERC20Options.options(id).then((x) => x.premium.toString()),
        `profit was counted incorrectly`
      )
    })
  });
  describe('Test profits', () => {
    for (const testPoint of priceTestPoints)
      it(`Should pay profit for exercised ITM (110%) option correctly (price: ${testPoint}%)`, () =>
        testOption({
          createPrice: toBN(200e8),
          strike: toBN(200e8).mul(toBN(11)).div(toBN(10)),
          exercisePrice: toBN(200e8).mul(toBN(testPoint)).div(toBN(100)),
        }))

    for (const testPoint of priceTestPoints)
      it(`Should pay profit for exercised ATM option correctly (price: ${testPoint}%)`, () =>
        testOption({
          createPrice: toBN(200e8),
          exercisePrice: toBN(200e8).mul(toBN(testPoint)).div(toBN(100)),
        }))

    for (const testPoint of priceTestPoints)
      it(`Should pay profit for exercised OTM (90%) option correctly (price: ${testPoint}%)`, () =>
        testOption({
          createPrice: toBN(200e8),
          strike: toBN(200e8).mul(toBN(9)).div(toBN(10)),
          exercisePrice: toBN(200e8).mul(toBN(testPoint)).div(toBN(100)),
        }))

    it("Shouldn't pay profit for exercised option when price is increased", () =>
      testOption({
        createPrice: toBN(200e8),
        exercisePrice: toBN(200e8 + 1),
      }))

    for (const testPoint of [190, 195, 200, 205, 210])
      it(`Show price for $${testPoint} strike`, () =>
        testOption({
          createPrice: toBN(200e8),
          strike: toBN(testPoint).mul(toBN(1e8)),
          exercisePrice: toBN(190e8),
        }))

    it("Should withdraw funds from the pool", async () => {
      const { ERC20LiquidityPool, WriterPool, WBTC } = await contracts
      const value = await ERC20LiquidityPool.availableBalance(WBTC.address)
      // console.log("availableBalance:", value)
      await timeTravel(14 * 24 * 3600 + 1)
      // await ERC20LiquidityPool.lockupPeriod().then(timeTravel)
      await WriterPool.setApprovalForAll(ERC20LiquidityPool.address, true, { from: user4 });

      await ERC20LiquidityPool.withdraw(value, "100000000000000000000000000000000", WBTC.address, { from: user4 })
    })

    it("Should print prices", () => {
      console.table(pricesBuf)
    })
  });

  async function provideFunds() {
    const { ERC20LiquidityPool, WBTC } = await contracts
    const value = toWei(100000)
    await WBTC.mintTo(user4, toWei(10000000000000000))
    await WBTC.approve(ERC20LiquidityPool.address, value, { from: user4 })
    await ERC20LiquidityPool.provide(value, 0, WBTC.address, { from: user4, gas: 1000000 })
  }
})
