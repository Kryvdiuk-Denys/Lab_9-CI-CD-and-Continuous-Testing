"use strict";
const { OrderRequest } = require("../src/models");
const { OrderService, OrderRejectedError } = require("../src/service");

function createService({ stock = 10, allowed = true } = {}) {
    const product = { id: 1, unitPrice: 60000, stock, onSale: false };
    const savedOrders = new Map();
    const products = { findById: jest.fn(async () => product) };
    const orders = {
        create: jest.fn(async order => {
            const saved = { ...order, id: 1, item: { ...order.item, id: 1 } };
            savedOrders.set(saved.id, saved);
            return saved;
        }),
        delete: jest.fn(async id => savedOrders.delete(id)),
        findById: jest.fn(async id => savedOrders.get(id) || null),
        updateStatus: jest.fn(async (id, status) => {
            const order = savedOrders.get(id);
            savedOrders.set(id, { ...order, status });
        })
    };
    const policy = { isAllowed: jest.fn(async () => allowed) };
    return { service: new OrderService(products, orders, policy), products, orders, policy, savedOrders };
}

test("premium orders receive the 10% discount at the threshold", () => {
    const { service } = createService();
    expect(service.calculateTotal(90000, 1, true)).toBe(81001);
    expect(service.calculateTotal(90000, 1, false)).toBe(90000);
});

test("stock rejection happens before the external policy check", async () => {
    const { service, orders, policy } = createService({ stock: 0 });
    const request = new OrderRequest("STOCK-1", 1, 1, false);

    await expect(service.placeOrder(request)).rejects.toBeInstanceOf(OrderRejectedError);
    expect(policy.isAllowed).not.toHaveBeenCalled();
    expect(orders.create).not.toHaveBeenCalled();
});

test("a denied order is not retained", async () => {
    const { service, orders, policy, savedOrders } = createService({ allowed: false });
    const request = new OrderRequest("DENIED-1", 1, 1, false);

    await expect(service.placeOrder(request)).rejects.toBeInstanceOf(OrderRejectedError);
    expect(policy.isAllowed).toHaveBeenCalledTimes(1);
    expect(savedOrders.size).toBe(0);
    expect(orders.delete).toHaveBeenCalledWith(1);
});
